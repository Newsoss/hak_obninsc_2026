"""Чтение/запись научных форматов с сохранением битности. Внутри всегда RGB."""
import base64
import io
from pathlib import PurePath
from typing import Dict, Optional, Tuple

import cv2
import numpy as np
import tifffile

from core.color import white_level
from i18n import t

SUPPORTED_EXTENSIONS = (".tif", ".tiff", ".png", ".jpg", ".jpeg", ".bmp")
MAX_PIXELS = 120_000_000

FORMATS = {
    "tiff": ("tif", "image/tiff"),
    "png": ("png", "image/png"),
    "jpeg": ("jpg", "image/jpeg"),
}


def _normalize_layout(image: np.ndarray) -> np.ndarray:
    image = np.squeeze(image)
    # Многостраничный / многомерный TIFF — берем первую плоскость
    while image.ndim > 3:
        image = image[0]
    # Планарный порядок (C, H, W) -> (H, W, C)
    if image.ndim == 3 and image.shape[0] in (3, 4) and image.shape[2] not in (3, 4):
        image = np.moveaxis(image, 0, -1)
    if image.ndim == 3:
        if image.shape[2] == 4:
            image = image[..., :3]
        elif image.shape[2] == 2:
            image = image[..., 0]
        elif image.shape[2] > 4:
            image = image[0]
    if image.ndim not in (2, 3):
        raise ValueError(t("io.dims"))
    return image


def _normalize_dtype(image: np.ndarray) -> np.ndarray:
    if image.dtype == np.bool_:
        return image.astype(np.uint8) * 255
    if image.dtype in (np.uint8, np.uint16, np.float32):
        return image
    return image.astype(np.float32)


def read_image(data: bytes, filename: str) -> np.ndarray:
    """Байты файла -> numpy (H, W) или (H, W, 3) в RGB с исходной битностью."""
    ext = PurePath(filename or "").suffix.lower()
    if ext and ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(t("io.ext", name=filename, ext=ext))
    if not data:
        raise ValueError(t("io.empty", name=filename))

    try:
        if ext in (".tif", ".tiff"):
            image = tifffile.imread(io.BytesIO(data))
        else:
            image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_UNCHANGED)
            if image is not None and image.ndim == 3:
                code = cv2.COLOR_BGRA2RGB if image.shape[2] == 4 else cv2.COLOR_BGR2RGB
                image = cv2.cvtColor(image, code)
    except Exception as exc:  # noqa: BLE001 — любые ошибки декодеров
        raise ValueError(t("io.corrupt", name=filename, error=exc)) from exc

    if image is None or image.size == 0:
        raise ValueError(t("io.decode", name=filename))
    if image.shape[0] * image.shape[1] > MAX_PIXELS:
        raise ValueError(t("io.too_big", name=filename))

    image = _normalize_dtype(_normalize_layout(image))
    return np.ascontiguousarray(image)


TEXT_TAGS = {"Make": 271, "Model": 272, "Artist": 315, "Copyright": 33432}
RESOLUTION_UNITS = {1: None, 2: 25400.0, 3: 10000.0}  # мкм в единице: дюйм, сантиметр


def _plain(value):
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def read_metadata(data: bytes, filename: str) -> Dict:
    """
    Метаданные исходного TIFF, которые нужно сохранить в результате: разрешение
    (размер пикселя), дата съемки, камера, автор и исходное описание (ImageJ/OME).
    Для остальных форматов — пустой словарь.
    """
    if PurePath(filename or "").suffix.lower() not in (".tif", ".tiff"):
        return {}
    try:
        with tifffile.TiffFile(io.BytesIO(data)) as tif:
            tags = tif.pages[0].tags
            meta: Dict = {}
            xres, yres = tags.get("XResolution"), tags.get("YResolution")
            if xres is not None and yres is not None:
                to_float = lambda v: v[0] / v[1] if isinstance(v, tuple) and v[1] else float(v)  # noqa: E731
                meta["resolution"] = [to_float(xres.value), to_float(yres.value)]
                unit = tags.get("ResolutionUnit")
                meta["resolution_unit"] = int(unit.value) if unit is not None else 2
            for name in ("DateTime", "Software", "ImageDescription", *TEXT_TAGS):
                tag = tags.get(name)
                if tag is not None and str(tag.value).strip():
                    meta[name] = str(tag.value)[:4000]
            if tif.is_imagej and tif.imagej_metadata:
                meta["ImageJ"] = {k: _plain(v) for k, v in tif.imagej_metadata.items()}
            if tif.is_ome:
                meta["OME"] = True
    except Exception:  # noqa: BLE001 — метаданные не должны ломать обработку
        return {}

    pixel = pixel_size(meta)
    if pixel:
        meta["pixel_size"] = pixel
    return meta


def pixel_size(meta: Dict) -> Optional[str]:
    """Размер пикселя человеческим языком: '0.3125 мкм'."""
    resolution = meta.get("resolution")
    if not resolution or not resolution[0]:
        return None
    um_per_unit = RESOLUTION_UNITS.get(meta.get("resolution_unit", 2))
    if um_per_unit:
        return f"{um_per_unit / resolution[0]:.4g} {t('unit.um')}"
    unit = (meta.get("ImageJ") or {}).get("unit")
    return f"{1 / resolution[0]:.4g} {unit}" if unit else None


def _ascii(text: str) -> str:
    return text.encode("ascii", "backslashreplace").decode("ascii")


def _tiff_tags(meta: Optional[Dict]) -> Dict:
    """Аргументы tifffile.imwrite, переносящие метаданные исходника в результат."""
    if not meta:
        return {}
    kwargs: Dict = {}
    if meta.get("resolution"):
        kwargs["resolution"] = tuple(meta["resolution"])
        kwargs["resolutionunit"] = meta.get("resolution_unit", 2)
    if meta.get("DateTime"):
        kwargs["datetime"] = _ascii(meta["DateTime"])[:19]
    extratags = [
        (code, "s", 0, _ascii(meta[name]), True) for name, code in TEXT_TAGS.items() if meta.get(name)
    ]
    if extratags:
        kwargs["extratags"] = extratags
    return kwargs


def _to_bgr(image: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(image, cv2.COLOR_RGB2BGR) if image.ndim == 3 else image


def to_display_u8(image: np.ndarray, white: Optional[float] = None) -> np.ndarray:
    """Линейно переводит любую битность в 8 бит для показа в браузере."""
    if image.dtype == np.uint8 and white in (None, 255.0):
        return image
    white = white or white_level(image)
    scaled = image.astype(np.float32) * (255.0 / white)
    return np.clip(scaled, 0, 255).astype(np.uint8)


def resize_max(image: np.ndarray, max_side: int) -> np.ndarray:
    h, w = image.shape[:2]
    scale = max_side / max(h, w)
    if scale >= 1:
        return image
    return cv2.resize(image, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)


def to_data_url(image_u8: np.ndarray, fmt: str = "jpeg", quality: int = 90) -> str:
    ext, mime = (".png", "image/png") if fmt == "png" else (".jpg", "image/jpeg")
    params = [cv2.IMWRITE_JPEG_QUALITY, quality] if ext == ".jpg" else []
    ok, encoded = cv2.imencode(ext, _to_bgr(image_u8), params)
    if not ok:
        raise RuntimeError("не удалось закодировать превью")
    return f"data:{mime};base64,{base64.b64encode(encoded).decode('ascii')}"


MIME_TYPES = {
    ".tif": "image/tiff", ".tiff": "image/tiff", ".png": "image/png",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".bmp": "image/bmp",
}


def mime_for(filename: str) -> str:
    return MIME_TYPES.get(PurePath(filename or "").suffix.lower(), "application/octet-stream")


def format_for(filename: str) -> str:
    ext = PurePath(filename or "").suffix.lower()
    if ext in (".tif", ".tiff"):
        return "tiff"
    if ext in (".jpg", ".jpeg"):
        return "jpeg"
    return "png"


def output_name(filename: str, fmt: str) -> str:
    stem = PurePath(filename or "image").stem
    return f"{stem}_ffc.{FORMATS[fmt][0]}"


def encode_image(
    image: np.ndarray,
    fmt: str,
    white: Optional[float] = None,
    description: Optional[str] = None,
    metadata: Optional[Dict] = None,
) -> Tuple[bytes, str]:
    """
    Кодирует массив в файл заданного формата. Возвращает (байты, MIME).
    description — журнал обработки; в TIFF записывается в тег ImageDescription.
    metadata — метаданные исходного TIFF (read_metadata), переносятся в теги результата.
    """
    if fmt not in FORMATS:
        raise ValueError(f"неизвестный формат {fmt}")
    mime = FORMATS[fmt][1]

    if fmt == "tiff":
        buffer = io.BytesIO()
        photometric = "rgb" if image.ndim == 3 else "minisblack"
        tifffile.imwrite(
            buffer, image, photometric=photometric, compression="zlib",
            description=description, metadata=None if description else {},
            software="MicroCleaner 2.0", **_tiff_tags(metadata),
        )
        return buffer.getvalue(), mime

    if fmt == "jpeg" or image.dtype not in (np.uint8, np.uint16):
        # JPEG — только 8 бит; float в PNG сохраняем как 16 бит
        if fmt == "jpeg":
            image = to_display_u8(image, white)
        else:
            w = white or white_level(image)
            image = np.clip(image.astype(np.float32) / w * 65535, 0, 65535).astype(np.uint16)

    params = [cv2.IMWRITE_JPEG_QUALITY, 95] if fmt == "jpeg" else []
    ok, encoded = cv2.imencode("." + FORMATS[fmt][0], _to_bgr(image), params)
    if not ok:
        raise RuntimeError(f"не удалось сохранить изображение в {fmt}")
    return encoded.tobytes(), mime
