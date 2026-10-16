"""
Тонкая цветокоррекция после выравнивания освещения.

Все операции выполняются над нормированным изображением, где 1.0 — уровень
белого исходной битности (255 для 8 бит, 4095 для 12-битной камеры и т.д.).
"""
import numpy as np

from core.flat_field import LUMA_WEIGHTS, to_luminance

DEFAULTS = {
    "exposure": 0.0,
    "brightness": 0.0,
    "contrast": 1.0,
    "gamma": 1.0,
    "saturation": 1.0,
    "temperature": 0.0,
    "tint": 0.0,
    "auto_white_balance": False,
    "auto_levels": False,
}


def white_level(image: np.ndarray) -> float:
    """
    Уровень белого. Для целочисленных данных — эффективная битность
    (12-битные данные в uint16 дают 4095, а не 65535), для float — 1.0
    либо максимум, если данные не нормированы.
    """
    if image.dtype == np.uint8:
        return 255.0
    peak = float(image.max()) if image.size else 0.0
    if np.issubdtype(image.dtype, np.integer):
        bits = max(8, int(np.ceil(np.log2(peak + 1))))
        return float(2 ** bits - 1)
    return 1.0 if peak <= 1.0 else peak


def is_identity(**params) -> bool:
    return all(params.get(k, v) == v for k, v in DEFAULTS.items())


def _gray_world(x: np.ndarray) -> np.ndarray:
    means = x.reshape(-1, 3).mean(axis=0)
    return x * (means.mean() / np.maximum(means, 1e-6))


def _auto_levels(x: np.ndarray, low: float = 0.5, high: float = 99.5) -> np.ndarray:
    lum = to_luminance(x)
    lo, hi = np.percentile(lum, [low, high])
    if hi - lo < 1e-6:
        return x
    return (x - lo) / (hi - lo)


def apply_color(
    x: np.ndarray,
    exposure: float = 0.0,
    brightness: float = 0.0,
    contrast: float = 1.0,
    gamma: float = 1.0,
    saturation: float = 1.0,
    temperature: float = 0.0,
    tint: float = 0.0,
    auto_white_balance: bool = False,
    auto_levels: bool = False,
) -> np.ndarray:
    """Цветокоррекция нормированного float32-изображения; результат в [0, 1]."""
    x = x.astype(np.float32, copy=True)
    color = x.ndim == 3 and x.shape[2] == 3

    if color:
        if auto_white_balance:
            x = _gray_world(x)
        if temperature or tint:
            x *= np.array(
                [1 + 0.25 * temperature, 1 - 0.25 * tint, 1 - 0.25 * temperature],
                dtype=np.float32,
            )

    if exposure:
        x *= 2.0 ** exposure
    if auto_levels:
        x = _auto_levels(x)
    if contrast != 1.0 or brightness:
        x = (x - 0.5) * contrast + 0.5 + brightness

    np.clip(x, 0.0, 1.0, out=x)
    if gamma != 1.0:
        np.power(x, 1.0 / gamma, out=x)

    if color and saturation != 1.0:
        lum = (x @ LUMA_WEIGHTS)[..., None]
        x = lum + (x - lum) * saturation
        np.clip(x, 0.0, 1.0, out=x)

    return x
