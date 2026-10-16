"""
Генератор реалистичного демо-набора: окрашенный препарат, снятый с
виньетированием, косым светом, теплым оттенком осветителя, пылью на оптике
и темновым шумом матрицы. Детерминирован — одинаков при каждом запуске.
"""
from functools import lru_cache
from typing import Dict

import cv2
import numpy as np

WIDTH, HEIGHT = 1280, 960
BRIGHT_LEVEL = 225.0
ILLUMINANT_TINT = np.array([1.0, 0.92, 0.76], dtype=np.float32)
SAMPLE_COUNT = 4


def _optics() -> np.ndarray:
    """Поле освещенности оптического тракта (общее для всех кадров серии)."""
    rng = np.random.default_rng(7)
    yy, xx = np.mgrid[0:HEIGHT, 0:WIDTH].astype(np.float32)
    cx, cy = WIDTH * 0.56, HEIGHT * 0.45
    r2 = ((xx - cx) ** 2 + (yy - cy) ** 2) / (0.62 * WIDTH) ** 2
    vignette = 1.0 / (1.0 + r2) ** 2
    slope = 1.0 - 0.22 * (xx / WIDTH) - 0.08 * (yy / HEIGHT)
    field = vignette * slope

    # Пыль и пятна на оптике: размытые темные кольца и точки
    dust = np.ones((HEIGHT, WIDTH), np.float32)
    for _ in range(14):
        x, y = rng.integers(0, WIDTH), rng.integers(0, HEIGHT)
        radius = int(rng.integers(6, 30))
        depth = float(rng.uniform(0.15, 0.45))
        spot = np.zeros_like(dust)
        cv2.circle(spot, (int(x), int(y)), radius, depth, -1 if rng.random() < 0.6 else 3)
        dust *= 1.0 - cv2.GaussianBlur(spot, (0, 0), sigmaX=radius / 3 + 1)

    return (field * dust)[..., None] * ILLUMINANT_TINT


def _dark(rng: np.random.Generator) -> np.ndarray:
    """Темновой кадр: пьедестал, полосы по колонкам и горячие пиксели."""
    dark = np.full((HEIGHT, WIDTH, 3), 6.0, np.float32)
    dark += rng.normal(0, 1.5, (1, WIDTH, 1)).astype(np.float32)
    hot = rng.random((HEIGHT, WIDTH)) < 0.0008
    dark[hot] += rng.uniform(40, 120, (int(hot.sum()), 1)).astype(np.float32)
    return dark


def _stain(t: np.ndarray, center, axes, angle: float, rgb, sigma: float) -> None:
    """Окрашенный эллипс, отрисованный только в своей окрестности (быстро)."""
    pad = max(axes) + int(4 * sigma) + 2
    x0, y0 = max(center[0] - pad, 0), max(center[1] - pad, 0)
    x1, y1 = min(center[0] + pad, WIDTH), min(center[1] + pad, HEIGHT)
    if x0 >= x1 or y0 >= y1:
        return
    mask = np.zeros((y1 - y0, x1 - x0), np.float32)
    cv2.ellipse(mask, (center[0] - x0, center[1] - y0), axes, angle, 0, 360, 1.0, -1)
    mask = cv2.GaussianBlur(mask, (0, 0), sigma)[..., None]
    t[y0:y1, x0:x1] *= 1 - mask * (1 - np.array(rgb, np.float32))


def _specimen(seed: int) -> np.ndarray:
    """Пропускание окрашенного препарата (в духе H&E): клетки с ядрами."""
    rng = np.random.default_rng(100 + seed)
    t = np.ones((HEIGHT, WIDTH, 3), np.float32)
    cytoplasm = [(0.93, 0.62, 0.80), (0.88, 0.55, 0.74), (0.95, 0.72, 0.84)]
    nucleus = [(0.42, 0.30, 0.62), (0.35, 0.25, 0.55)]

    fibers = np.zeros((HEIGHT, WIDTH), np.float32)
    for _ in range(18):
        pts = np.cumsum(rng.normal(0, 40, (8, 2)), axis=0) + rng.uniform(0, [WIDTH, HEIGHT])
        cv2.polylines(fibers, [pts.astype(np.int32)], False, 1.0, 3)
    fibers = cv2.GaussianBlur(fibers, (0, 0), 2.0)[..., None]
    t *= 1 - fibers * (1 - np.array([0.96, 0.78, 0.86], np.float32))

    for _ in range(int(rng.integers(55, 80))):
        cx, cy = int(rng.integers(0, WIDTH)), int(rng.integers(0, HEIGHT))
        ax = int(rng.integers(18, 46))
        axes = (ax, int(ax * rng.uniform(0.6, 1.0)))
        angle = float(rng.uniform(0, 180))
        _stain(t, (cx, cy), axes, angle, cytoplasm[rng.integers(len(cytoplasm))], 1.6)

        n_axes = (max(5, axes[0] // 3), max(4, axes[1] // 3))
        offset = rng.normal(0, axes[1] / 6, 2).astype(int)
        center = (cx + int(offset[0]), cy + int(offset[1]))
        _stain(t, center, n_axes, angle, nucleus[rng.integers(len(nucleus))], 1.2)

    return t


def _to_u8(image: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    noisy = image + rng.normal(0, 1.8, image.shape).astype(np.float32)
    return np.clip(np.rint(noisy), 0, 255).astype(np.uint8)


@lru_cache(maxsize=8)
def generate(name: str) -> np.ndarray:
    """Возвращает RGB uint8 кадр: 'bright', 'dark' или 'sample-1'..'sample-N'."""
    optics = _optics()
    dark = _dark(np.random.default_rng(11))
    if name == "dark":
        return _to_u8(dark, np.random.default_rng(1))
    if name == "bright":
        return _to_u8(dark + BRIGHT_LEVEL * optics, np.random.default_rng(2))
    if name.startswith("sample-"):
        index = int(name.split("-", 1)[1])
        if 1 <= index <= SAMPLE_COUNT:
            light = BRIGHT_LEVEL * optics * _specimen(index)
            return _to_u8(dark + light, np.random.default_rng(20 + index))
    raise KeyError(name)


def catalog() -> Dict[str, str]:
    items = {"bright": "Светлое поле", "dark": "Темновой кадр"}
    items.update({f"sample-{i}": f"Препарат №{i}" for i in range(1, SAMPLE_COUNT + 1)})
    return items
