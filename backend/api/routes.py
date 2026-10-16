import json
import uuid
from collections import OrderedDict
from typing import List, Optional
from urllib.parse import quote

from fastapi import APIRouter, File, Form, HTTPException, Query, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from adapters import image_io
from core import demo
from core.calibration import check_frame
from schemas.processing import (
    CorrectionSettings,
    CropRequest,
    DemoItem,
    ExportRequest,
    FrameInfo,
    FrameRefs,
    PreviewResponse,
    ProbeRequest,
)
from services.correction import CorrectionService, sha256, thumbnail
from services.frame_store import Frame, FrameStore

router = APIRouter()
store = FrameStore()
service = CorrectionService()

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


def _refs(req: FrameRefs):
    raw = _frame(req.raw_id, "Исходный снимок")
    bright = _frame(req.bright_id, "Светлое поле")
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


async def _read(upload: UploadFile):
    """Возвращает (изображение, сведения о файле: имя и SHA-256, метаданные исходного TIFF)."""
    data = await upload.read()
    name = upload.filename or "image"
    try:
        image = await run_in_threadpool(image_io.read_image, data, name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    return image, {"name": name, "sha256": sha256(data)}, image_io.read_metadata(data, name)


def _info(frame: Optional[Frame]) -> Optional[dict]:
    return {"name": frame.name, "sha256": frame.sha256} if frame else None


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
    thumb = image_io.to_display_u8(image_io.resize_max(image, 360))
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
        checks=checks,
        metadata=meta or None,
    )


@router.post("/process/preview", response_model=PreviewResponse, tags=["Processing"])
def preview(req: FrameRefs):
    """Превью «до/после», карта освещенности и метрики равномерности."""
    raw, bright, dark, key = _refs(req)
    return service.preview(raw.image, bright.image, dark.image if dark else None, req.settings, key)


@router.post("/process/export", tags=["Processing"])
def export(req: ExportRequest):
    """Полноразмерный результат в исходной битности (или в выбранном формате)."""
    raw, bright, dark, key = _refs(req)
    provenance = {"source": _info(raw), "bright_field": _info(bright), "dark_field": _info(dark)}
    data, name, mime, report, _ = service.export(
        raw.image, raw.name, bright.image, dark.image if dark else None,
        req.settings, req.format, key, provenance, raw.meta, raw.id,
    )
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


@router.get("/demo", response_model=List[DemoItem], tags=["Demo"])
def demo_catalog():
    return [DemoItem(name=n, title=t, url=f"/api/demo/{n}.png") for n, t in demo.catalog().items()]


@router.get("/demo/{name}.png", tags=["Demo"])
def demo_image(name: str):
    """Синтетический кадр с виньетированием, пылью, оттенком и темновым шумом."""
    try:
        image = demo.generate(name)
    except (KeyError, ValueError):
        raise HTTPException(404, "Нет такого демо-кадра") from None
    data, mime = image_io.encode_image(image, "png")
    return Response(data, media_type=mime, headers={"Cache-Control": "public, max-age=86400"})
