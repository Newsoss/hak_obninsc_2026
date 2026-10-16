"""Чтение/запись научных форматов с сохранением битности. Внутри всегда RGB."""
import base64
import io
from pathlib import PurePath
from typing import Optional, Tuple

import cv2
import numpy as np
import tifffile

from core.color import white_level

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
        raise ValueError("неподдерживаемая размерность изображения")
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
        raise ValueError(f"{filename}: формат {ext} не поддерживается")
    if not data:
        raise ValueError(f"{filename}: пустой файл")

    try:
        if ext in (".tif", ".tiff"):
            image = tifffile.imread(io.BytesIO(data))
        else:
            image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_UNCHANGED)
            if image is not None and image.ndim == 3:
                code = cv2.COLOR_BGRA2RGB if image.shape[2] == 4 else cv2.COLOR_BGR2RGB
                image = cv2.cvtColor(image, code)
    except Exception as exc:  # noqa: BLE001 — любые ошибки декодеров
        raise ValueError(f"{filename}: файл поврежден ({exc})") from exc

    if image is None or image.size == 0:
        raise ValueError(f"{filename}: не удалось декодировать изображение")
    if image.shape[0] * image.shape[1] > MAX_PIXELS:
        raise ValueError(f"{filename}: изображение слишком большое")

    image = _normalize_dtype(_normalize_layout(image))
    return np.ascontiguousarray(image)


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
    image: np.ndarray, fmt: str, white: Optional[float] = None, description: Optional[str] = None
) -> Tuple[bytes, str]:
    """
    Кодирует массив в файл заданного формата. Возвращает (байты, MIME).
    description — журнал обработки; в TIFF записывается в тег ImageDescription.
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
