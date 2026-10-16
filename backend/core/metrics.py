"""Объективные метрики качества освещения и гистограммы."""
from typing import Dict

import cv2
import numpy as np

from core.flat_field import to_luminance

MAP_SIZE = 128


def illumination_field(image: np.ndarray) -> np.ndarray:
    """
    Оценка поля освещенности: уменьшенная и сильно размытая яркость.
    Мелкие объекты препарата «растворяются», остается тренд фона.
    """
    lum = to_luminance(image)
    h, w = lum.shape
    scale = MAP_SIZE / max(h, w)
    small = cv2.resize(
        lum, (max(8, round(w * scale)), max(8, round(h * scale))), interpolation=cv2.INTER_AREA
    )
    return cv2.GaussianBlur(small, (0, 0), sigmaX=MAP_SIZE / 16)


def uniformity(image: np.ndarray) -> Dict[str, float]:
    """
    nonuniformity — коэффициент вариации поля освещенности, % (меньше — лучше);
    vignetting — яркость углов относительно центра, % (100 — нет виньетирования).
    """
    field = illumination_field(image)
    mean = float(field.mean())
    if mean <= 1e-6:
        return {"nonuniformity": 0.0, "vignetting": 100.0}

    h, w = field.shape
    ch, cw = max(1, h // 8), max(1, w // 8)
    corners = np.concatenate(
        [
            field[:ch, :cw].ravel(),
            field[:ch, -cw:].ravel(),
            field[-ch:, :cw].ravel(),
            field[-ch:, -cw:].ravel(),
        ]
    )
    center = field[h // 2 - ch : h // 2 + ch, w // 2 - cw : w // 2 + cw]
    return {
        "nonuniformity": round(float(field.std()) / mean * 100, 2),
        "vignetting": round(float(corners.mean()) / max(float(center.mean()), 1e-6) * 100, 1),
    }


def illumination_heatmap(gain: np.ndarray) -> np.ndarray:
    """Цветная карта освещенности (1 / gain) — то, что видит камера без образца."""
    light = 1.0 / np.maximum(to_luminance(gain), 1e-6)
    light = (light - light.min()) / max(float(np.ptp(light)), 1e-6)
    h, w = light.shape
    scale = 512 / max(h, w)
    if scale < 1:
        light = cv2.resize(light, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    colored = cv2.applyColorMap((light * 255).astype(np.uint8), cv2.COLORMAP_TURBO)
    return cv2.cvtColor(colored, cv2.COLOR_BGR2RGB)
