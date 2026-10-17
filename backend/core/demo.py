"""
Генератор демо-набора: препарат, снятый с виньетированием, косым светом,
теплым оттенком осветителя, пылью на оптике и темновым шумом матрицы.
Детерминирован — одинаков при каждом запуске.

Препарат берется либо встроенный (нарисованные клетки), либо из любого
чистого снимка (sample_from_image): на него накладывается та же искусственная
засветка, а светлое поле и темновой кадр к нему генерируются точно.
"""
from functools import lru_cache
from typing import Dict

import cv2
import numpy as np

WIDTH, HEIGHT = 1280, 960
BRIGHT_LEVEL = 225.0
ILLUMINANT_TINT = np.array([1.0, 0.92, 0.76], dtype=np.float32)
SAMPLE_COUNT = 8


@lru_cache(maxsize=1)
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

    # Межклеточное вещество: слабая неоднородная окраска фона
    stroma = cv2.GaussianBlur(rng.random((HEIGHT, WIDTH)).astype(np.float32), (0, 0), 18)
    stroma = (stroma - stroma.min()) / max(float(np.ptp(stroma)), 1e-6)
    t *= 1 - 0.12 * stroma[..., None] * (1 - np.array([0.95, 0.80, 0.88], np.float32))

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


def specimen_from_image(image: np.ndarray) -> np.ndarray:
    """
    Пропускание препарата из готового снимка: кадр обрезается по центру до 4:3,
    приводится к размеру демо-набора и нормируется так, что фон ≈ 1.
    Снимок должен быть равномерно освещен — иначе его собственная неравномерность
    останется и после коррекции.
    """
    img = image.astype(np.float32)
    if img.ndim == 2:
        img = np.repeat(img[..., None], 3, axis=2)
    h, w = img.shape[:2]
    target = WIDTH / HEIGHT
    if w / h > target:
        cw = int(round(h * target))
        img = img[:, (w - cw) // 2 : (w - cw) // 2 + cw]
    else:
        ch = int(round(w / target))
        img = img[(h - ch) // 2 : (h - ch) // 2 + ch]
    interp = cv2.INTER_AREA if img.shape[1] > WIDTH else cv2.INTER_CUBIC
    img = cv2.resize(img, (WIDTH, HEIGHT), interpolation=interp)
    white = float(np.percentile(img.mean(axis=2), 99.5))
    return np.clip(img / max(white, 1e-6), 0.02, 1.0)


def builtin_specimen(seed: int = 1) -> np.ndarray:
    """Встроенный препарат (пропускание 0..1) для проверки метода."""
    return _specimen(seed)


def simulate(transmittance: np.ndarray, seed: int = 1) -> Dict[str, np.ndarray]:
    """
    Съемка известного препарата через «плохую» оптику: снимок, светлое поле и
    темновой кадр (8 бит, с шумом), а также эталон — каким должен получиться
    идеально исправленный снимок: T × m, где m — средняя яркость светлого поля.
    """
    light = BRIGHT_LEVEL * _optics()
    return {
        "raw": _to_u8(_dark(np.random.default_rng(11)) + light * transmittance, np.random.default_rng(500 + seed)),
        "bright": generate("bright"),
        "dark": generate("dark"),
        "truth": (transmittance * float(light.mean())).astype(np.float32),
    }


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
