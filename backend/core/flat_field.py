"""
Flat-field correction (FFC).

    C = (R - D) / (F - D) * m

R — исходный снимок, F — светлое калибровочное поле (bright field),
D — темновой кадр (dark field, необязателен), m — средняя яркость (F - D),
которая сохраняет исходную экспозицию.

Профиль коррекции (gain = m / (F - D)) вычисляется один раз и затем
применяется к любому количеству снимков — это и есть «обработка серии
одним профилем».
"""
from dataclasses import dataclass
from typing import Optional, Tuple

import cv2
import numpy as np

# Минимальное значение знаменателя относительно средней яркости поля.
# Защищает от деления на ноль и от «взрыва» битых/черных пикселей калибровки.
FLAT_FLOOR_RATIO = 0.01

LUMA_WEIGHTS = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


@dataclass(frozen=True)
class FlatProfile:
    """Готовый профиль коррекции: множитель усиления и темновой кадр."""

    gain: np.ndarray
    dark: Optional[np.ndarray]

    @property
    def shape(self) -> Tuple[int, ...]:
        return self.gain.shape


def finite(image: np.ndarray) -> np.ndarray:
    """float32-копия без NaN/Inf (встречаются во float-TIFF после других программ)."""
    return np.nan_to_num(image.astype(np.float32), nan=0.0, posinf=0.0, neginf=0.0)


def to_luminance(image: np.ndarray) -> np.ndarray:
    """Яркостный канал (float32) для одноканальных и RGB-изображений."""
    img = image.astype(np.float32, copy=False)
    if img.ndim == 2:
        return img
    return img[..., :3] @ LUMA_WEIGHTS


def match_geometry(calib: np.ndarray, shape: Tuple[int, ...]) -> np.ndarray:
    """
    Подгоняет калибровочный кадр под размер и число каналов снимка.
    Калибровку обычно снимают той же камерой, но превью и бининг дают
    другое разрешение, поэтому кадр масштабируется, а не отвергается.
    """
    calib = calib.astype(np.float32, copy=False)
    h, w = shape[:2]
    if calib.shape[:2] != (h, w):
        shrinking = calib.shape[0] > h or calib.shape[1] > w
        interp = cv2.INTER_AREA if shrinking else cv2.INTER_LINEAR
        calib = cv2.resize(calib, (w, h), interpolation=interp)

    target_channels = 1 if len(shape) == 2 else shape[2]
    calib_channels = 1 if calib.ndim == 2 else calib.shape[2]
    if target_channels == calib_channels:
        return calib
    if target_channels == 1:
        return to_luminance(calib)
    if calib.ndim == 3:
        calib = to_luminance(calib)
    return np.repeat(calib[..., None], target_channels, axis=2)


def build_profile(
    bright: np.ndarray,
    dark: Optional[np.ndarray] = None,
    smoothing: float = 0.0,
    neutralize_color: bool = True,
) -> FlatProfile:
    """
    Строит профиль коррекции по светлому (и, опционально, темному) кадру.

    :param smoothing: сигма гауссова размытия поля в пикселях. Подавляет шум
        калибровочного кадра, но размывает пятна пыли — по умолчанию выключено.
    :param neutralize_color: True — одна общая нормировка m для всех каналов,
        что заодно убирает цветовой оттенок осветителя (фон становится серым).
        False — нормировка по каналам, исходный баланс белого сохраняется.
    """
    flat = finite(bright)
    dark_f = match_geometry(finite(dark), flat.shape) if dark is not None else None
    if dark_f is not None:
        flat = flat - dark_f

    if smoothing > 0:
        flat = cv2.GaussianBlur(flat, (0, 0), sigmaX=float(smoothing))

    positive = flat[flat > 0]
    level = float(positive.mean()) if positive.size else 1.0
    flat = np.maximum(flat, max(level * FLAT_FLOOR_RATIO, 1e-6))

    if flat.ndim == 3 and not neutralize_color:
        m = flat.reshape(-1, flat.shape[2]).mean(axis=0)
    else:
        m = flat.mean()

    gain = (m / flat).astype(np.float32)
    return FlatProfile(gain=gain, dark=dark_f)


def apply_profile(raw: np.ndarray, profile: FlatProfile) -> np.ndarray:
    """Применяет профиль к снимку. Возвращает float32 в единицах исходных отсчетов."""
    img = finite(raw)
    if profile.dark is not None:
        img = img - match_geometry(profile.dark, img.shape)
        np.maximum(img, 0, out=img)
    return img * match_geometry(profile.gain, img.shape)


def to_dtype(image: np.ndarray, dtype: np.dtype) -> np.ndarray:
    """Возвращает float-результат в исходную битность с отсечением диапазона."""
    dtype = np.dtype(dtype)
    if np.issubdtype(dtype, np.integer):
        info = np.iinfo(dtype)
        return np.clip(np.rint(image), info.min, info.max).astype(dtype)
    return image.astype(dtype)


def flat_field_correct(
    raw: np.ndarray,
    bright: np.ndarray,
    dark: Optional[np.ndarray] = None,
    smoothing: float = 0.0,
    neutralize_color: bool = True,
) -> np.ndarray:
    """Коррекция одного снимка «в одну строку»; результат в битности исходника."""
    profile = build_profile(bright, dark, smoothing, neutralize_color)
    return to_dtype(apply_profile(raw, profile), raw.dtype)
