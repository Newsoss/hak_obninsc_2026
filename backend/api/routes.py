import json
import uuid
from collections import OrderedDict
from typing import List, Optional
from urllib.parse import quote

from fastapi import APIRouter, File, Form, HTTPException, Query, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

import config
from adapters import image_io
from core import estimate
from core.calibration import check_frame, temporal_noise
from schemas.processing import (
    CorrectionSettings,
    CropRequest,
    ExportRequest,
    FrameInfo,
    FrameRefs,
    PreviewResponse,
    ProbeRequest,
)
from services import verify
from services.correction import CorrectionService, sha256, thumbnail
from services.frame_store import Frame, FrameStore

router = APIRouter()
store = FrameStore(max_bytes=config.FRAME_STORE_MB * config.MB)
service = CorrectionService()

# Псевдо светлое поле по одному снимку (если светлое поле не загружено): по id снимка
_pseudo_flats: "OrderedDict[str, Frame]" = OrderedDict()

# Миниатюры «до/после» для сводки серии: создаются при обработке файла и забираются по id
_thumbs: "OrderedDict[str, dict]" = OrderedDict()
THUMBS_LIMIT = 1000


def _frame(frame_id: Optional[str], label: str) -> Optional[Frame]:
    if frame_id is None:
        return None
    try:
        return store.get(frame_id)
    except KeyError:
        raise HTTPException(404, f"{label} не найден — загрузите файл заново") from None


def _pseudo_flat(raw: Frame) -> Frame:
    """Светлое поле, оцененное по самому снимку. Считается один раз на снимок."""
    if raw.id in _pseudo_flats:
        _pseudo_flats.move_to_end(raw.id)
        return _pseudo_flats[raw.id]
    flat = Frame(
        id=f"gauss-{raw.id}",
        name="оценка по снимку (размытие Гаусса)",
        image=estimate.gaussian_flat(raw.image),
        meta={"estimated": {"method": "gaussian", "note": estimate.GAUSSIAN_NOTE}},
    )
    _pseudo_flats[raw.id] = flat
    while len(_pseudo_flats) > 16:
        _pseudo_flats.popitem(last=False)
    return flat


def _estimated(frame: Optional[Frame]) -> Optional[dict]:
    return (frame.meta or {}).get("estimated") if frame else None


def _refs(req: FrameRefs):
    raw = _frame(req.raw_id, "Исходный снимок")
    bright = _frame(req.bright_id, "Светлое поле") if req.bright_id else _pseudo_flat(raw)
    dark = _frame(req.dark_id, "Темновой кадр")
    key = (bright.id, dark.id if dark else None)
    return raw, bright, dark, key


def _settings(raw: Optional[str]) -> CorrectionSettings:
    if not raw:
        return CorrectionSettings()
    try:
        return CorrectionSettings.model_validate_json(raw)
    except ValidationError as exc:
        raise HTTPException(422, f"Некорректные настройки: {exc.errors()[0]['msg']}") from None


def _check_size(size: Optional[int], name: str) -> None:
    if size is not None and size > config.MAX_UPLOAD_MB * config.MB:
        raise HTTPException(413, f"{name}: файл больше {config.MAX_UPLOAD_MB} МБ")


def _check_count(files: List[UploadFile]) -> None:
    if len(files) > config.MAX_FILES_PER_REQUEST:
        raise HTTPException(413, f"Слишком много файлов в одном запросе (больше {config.MAX_FILES_PER_REQUEST})")


async def _read(upload: UploadFile):
    """Возвращает (изображение, сведения о файле: имя и SHA-256, метаданные исходного TIFF)."""
    name = upload.filename or "image"
    _check_size(upload.size, name)
    data = await upload.read()
    _check_size(len(data), name)
    try:
        image = await run_in_threadpool(image_io.read_image, data, name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    return image, {"name": name, "sha256": sha256(data)}, image_io.read_metadata(data, name)


def _info(frame: Optional[Frame]) -> Optional[dict]:
    if frame is None:
        return None
    info = {"name": frame.name, "sha256": frame.sha256 or None}
    if _estimated(frame):
        info["estimated"] = _estimated(frame)
    return info


def _frame_info(frame: Frame, checks: Optional[List[str]] = None) -> FrameInfo:
    image = frame.image
    thumb = image_io.to_display_u8(image_io.resize_max(image, 360))
    meta = frame.meta or {}
    return FrameInfo(
        id=frame.id,
        name=frame.name,
        width=image.shape[1],
        height=image.shape[0],
        channels=1 if image.ndim == 2 else image.shape[2],
        dtype=str(image.dtype),
        bit_depth=image.dtype.itemsize * 8,
        sha256=frame.sha256,
        thumbnail=image_io.to_data_url(thumb, quality=80),
        checks=checks or [],
        metadata={k: v for k, v in meta.items() if k not in ("estimated", "averaged")} or None,
        estimated=meta.get("estimated"),
        averaged=meta.get("averaged"),
    )


def _file_response(data: bytes, name: str, mime: str, report: dict, extra: Optional[dict] = None) -> Response:
    headers = {
        "Content-Disposition": _attachment(name),
        "X-Correction-Report": json.dumps(report),
        **(extra or {}),
    }
    headers["Access-Control-Expose-Headers"] = ", ".join(k for k in headers if k != "Content-Disposition") + ", Content-Disposition"
    return Response(data, media_type=mime, headers=headers)


def _attachment(name: str) -> str:
    return f"attachment; filename*=UTF-8''{quote(name)}"


@router.get("/health", tags=["System"])
def health():
    return {"status": "ok", "service": "MicroCleaner API"}


@router.post("/frames", response_model=FrameInfo, tags=["Frames"])
async def upload_frame(
    file: UploadFile = File(..., description="Снимок или калибровочный кадр"),
    role: Optional[str] = Query(None, description="raw | bright | dark — для проверки калибровки"),
):
    """Загружает кадр (TIFF 8/16/32 бит, PNG, JPEG, BMP), проверяет калибровку и возвращает id."""
    image, source, meta = await _read(file)
    checks = await run_in_threadpool(check_frame, image, role or "raw")
    frame = store.put(source["name"], image, source["sha256"], meta)
    return _frame_info(frame, checks)


@router.post("/frames/average", response_model=FrameInfo, tags=["Frames"])
async def average_frames(
    files: List[UploadFile] = File(..., description="Несколько кадров светлого поля или темнового кадра"),
    role: str = Query("bright", description="bright | dark"),
):
    """
    Усредняет несколько калибровочных кадров (master flat / master dark): случайный шум
    калибровки падает примерно в √N раз. Крайние значения в каждой точке отбрасываются.
    """
    _check_count(files)
    loaded = [await _read(f) for f in files]
    images = [image for image, _, _ in loaded]
    try:
        averaged = await run_in_threadpool(estimate.average_stack, images)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    single, mean = await run_in_threadpool(temporal_noise, images)
    gain = round(single / mean, 1) if mean > 1e-9 and len(images) >= 4 else None
    names = [source["name"] for _, source, _ in loaded]
    label = "светлого поля" if role == "bright" else "темнового кадра"
    info = {
        "count": len(images),
        "files": names,
        "noise_reduction": gain,
        "note": f"Среднее {len(images)} кадров {label}, крайние значения отброшены"
        + (f"; случайный шум ниже в {gain} раза" if gain else ""),
    }
    frame = store.put(
        f"среднее {len(images)} кадров ({names[0]}…)",
        averaged,
        meta={**(loaded[0][2] or {}), "averaged": info},
    )
    # Пересвет и прочее проверяем на исходном кадре: у среднего во float другой «уровень белого»
    checks = await run_in_threadpool(check_frame, images[0], role)
    return _frame_info(frame, checks)


@router.post("/verify", tags=["Verification"])
async def verify_method(
    file: Optional[UploadFile] = File(None, description="Чистый равномерно освещенный снимок; без файла — встроенный"),
):
    """
    Проверка метода на эталоне: известный снимок проходит через оптику с виньетированием,
    пылью и оттенком, исправляется и сравнивается с оригиналом.
    """
    if file is not None and file.filename:
        image, source, _ = await _read(file)
        return await run_in_threadpool(verify.verify, image, source["name"])
    return await run_in_threadpool(verify.verify)


@router.post("/flat/series", response_model=FrameInfo, tags=["Frames"])
async def estimate_flat_from_series(
    files: List[UploadFile] = File(..., description=f"Снимки серии, минимум {estimate.MIN_SERIES}"),
):
    """
    Оценивает светлое поле как медиану по серии снимков разных полей зрения.
    Нужна, когда светлое поле не снимали. Результат — обычный кадр с id для обработки серии.
    """
    _check_count(files)
    images = [(await _read(f))[0] for f in files]
    try:
        flat, checks = await run_in_threadpool(estimate.median_flat, images)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    count = min(len(images), estimate.MAX_SERIES)
    note = estimate.MEDIAN_NOTE.format(count=count)
    frame = store.put(
        f"оценка по серии ({count} снимков, медиана)",
        flat,
        meta={"estimated": {"method": "median", "count": count, "note": note}},
    )
    return _frame_info(frame, checks)


@router.post("/process/preview", response_model=PreviewResponse, tags=["Processing"])
def preview(req: FrameRefs):
    """Превью «до/после», карта освещенности и метрики равномерности."""
    raw, bright, dark, key = _refs(req)
    estimated = _estimated(bright)
    response = service.preview(
        raw.image, bright.image, dark.image if dark else None, req.settings, key, estimated is not None
    )
    response["approximate"] = estimated["note"] if estimated else None
    return response


@router.post("/process/export", tags=["Processing"])
def export(req: ExportRequest):
    """Полноразмерный результат в исходной битности (или в выбранном формате)."""
    raw, bright, dark, key = _refs(req)
    provenance = {"source": _info(raw), "bright_field": _info(bright), "dark_field": _info(dark)}
    data, name, mime, report, _ = service.export(
        raw.image, raw.name, bright.image, dark.image if dark else None,
        req.settings, req.format, key, provenance, raw.meta, raw.id,
    )
    report["bright_field"] = provenance["bright_field"]
    return _file_response(data, name, mime, report)


def _full(req: FrameRefs):
    raw, bright, dark, key = _refs(req)
    return raw.id, raw.image, bright.image, dark.image if dark else None, req.settings, key


@router.post("/process/probe", tags=["Processing"])
def probe(req: ProbeRequest):
    """Значение пикселя до и после коррекции в исходных единицах (полное разрешение)."""
    args = _full(req)
    return service.probe(*args, req.x, req.y)


@router.post("/process/crop", tags=["Processing"])
def crop(req: CropRequest):
    """Участок снимка в полном разрешении (для сильного увеличения)."""
    args = _full(req)
    return service.crop(*args, req.x0, req.y0, req.x1, req.y1, req.max_side)


@router.post("/process/file", tags=["Processing"])
async def process_file(
    raw: UploadFile = File(..., description="Снимок серии"),
    bright_id: str = Form(..., description="id светлого поля из /frames"),
    dark_id: Optional[str] = Form(None, description="id темнового кадра из /frames"),
    settings: Optional[str] = Form(None, description="CorrectionSettings в JSON"),
    format: Optional[str] = Form(None, description="tiff | png | jpeg"),
    thumbs: bool = Form(False, description="Подготовить миниатюры до/после для сводки"),
):
    """Один снимок серии с уже загруженной калибровкой — для пакетной обработки с прогрессом."""
    image, source, meta = await _read(raw)
    bright = _frame(bright_id, "Светлое поле")
    dark = _frame(dark_id, "Темновой кадр")
    if format not in (None, "", *image_io.FORMATS):
        raise HTTPException(422, f"Неизвестный формат {format}")
    provenance = {"source": source, "bright_field": _info(bright), "dark_field": _info(dark)}
    data, name, mime, report, result = await run_in_threadpool(
        service.export, image, source["name"], bright.image, dark.image if dark else None,
        _settings(settings), format or None, (bright.id, dark.id if dark else None), provenance, meta,
    )
    report["bright_field"] = provenance["bright_field"]
    extra = {}
    if thumbs:
        pair = await run_in_threadpool(
            lambda: {"before": thumbnail(image, result.white), "after": thumbnail(result.image, result.white)}
        )
        thumb_id = uuid.uuid4().hex
        _thumbs[thumb_id] = pair
        while len(_thumbs) > THUMBS_LIMIT:
            _thumbs.popitem(last=False)
        extra["X-Thumbs-Id"] = thumb_id
    return _file_response(data, name, mime, report, extra)


@router.get("/thumbs/{thumb_id}", tags=["Processing"])
def get_thumbs(thumb_id: str):
    """Миниатюры до/после, подготовленные при обработке файла серии."""
    pair = _thumbs.get(thumb_id)
    if pair is None:
        raise HTTPException(404, "Миниатюры не найдены")
    return pair


@router.post("/process/batch", tags=["Processing"])
async def process_batch(
    raw_images: List[UploadFile] = File(..., description="Серия снимков"),
    bright_image: UploadFile = File(..., description="Светлое поле"),
    dark_image: Optional[UploadFile] = File(None, description="Темновой кадр"),
    settings: Optional[str] = Form(None, description="CorrectionSettings в JSON"),
    format: Optional[str] = Form(None, description="tiff | png | jpeg"),
):
    """Самодостаточный пакетный режим: все файлы в одном запросе, в ответ — ZIP с результатами и processing.json."""
    if format not in (None, "", *image_io.FORMATS):
        raise HTTPException(422, f"Неизвестный формат {format}")
    _check_count(raw_images)
    for f in raw_images:
        _check_size(f.size, f.filename or "image")
    bright, bright_info, _ = await _read(bright_image)
    dark, dark_info, _ = await _read(dark_image) if dark_image and dark_image.filename else (None, None, None)
    raws = [(f.filename or f"image_{i}.png", await f.read()) for i, f in enumerate(raw_images)]
    calibration = {"bright_field": bright_info, "dark_field": dark_info}
    archive = await run_in_threadpool(
        service.batch, raws, bright, dark, _settings(settings), format or None, calibration
    )
    return StreamingResponse(
        archive,
        media_type="application/zip",
        headers={"Content-Disposition": _attachment("microcleaner_batch.zip")},
    )
