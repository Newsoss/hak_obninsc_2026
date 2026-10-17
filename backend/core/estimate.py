"""
Оценка светлого поля, когда его не снимали (ретроспективная коррекция).

- gaussian_flat: по одному снимку. Фон = сильно размытый снимок, из которого
  исключены объекты препарата. Приблизительно: крупные объекты и плавные
  перепады окраски могут частично попасть в «фон».
- series_flat: по серии. В каждой точке кадра берется «фоновое» значение:
  на светлом поле препарат всегда темнее фона, поэтому берется второе по
  яркости значение среди снимков (одно самое яркое отбрасывается как выброс).
  Клетка попадет в оценку, только если лежит в этой точке почти на всех
  снимках. Медиана так не умеет: ей хватает клетки на половине снимков, и на
  результате появляются «призраки» клеток. Для флуоресценции (светлые объекты
  на темном фоне) направление определяется автоматически.
"""
from typing import List, Tuple

import cv2
import numpy as np

from core.calibration import STRUCTURE_LIMIT, structure_fraction
from core.flat_field import finite, match_geometry, to_luminance
from i18n import t

GAUSSIAN_SIDE = 768
MEDIAN_SIDE = 512
MIN_SERIES = 5
RELIABLE_SERIES = 10
MAX_SERIES = 64
OBJECT_DEVIATION = 0.08  # отклонение от фона, после которого пиксель считается объектом
# Размытие: 1/25 стороны кадра. Подобрано по отклонению от коррекции настоящим светлым полем:
# сильнее размытие — не догоняет виньетирование в углах, слабее — «стирает» крупные клетки.
GAUSSIAN_SIGMA_FRACTION = 1 / 25



def _shrink(image: np.ndarray, side: int) -> np.ndarray:
    img = finite(image)
    h, w = img.shape[:2]
    scale = min(1.0, side / max(h, w))
    if scale < 1:
        img = cv2.resize(img, (max(8, round(w * scale)), max(8, round(h * scale))), interpolation=cv2.INTER_AREA)
    return img


def _without_dark(image: np.ndarray, dark) -> np.ndarray:
    if dark is None:
        return finite(image)
    return np.maximum(finite(image) - match_geometry(finite(dark), image.shape), 0)


def _with_dark(flat: np.ndarray, dark) -> np.ndarray:
    """
    Оценка строится по снимкам без темнового кадра, а хранится «как снятое светлое поле»:
    к ней прибавляется темновой кадр в ее (уменьшенном) размере. Дальше профиль вычитает
    ровно его же и получает точную оценку — без горячих пикселей и полос матрицы.
    """
    return flat if dark is None else flat + match_geometry(finite(dark), flat.shape)


def gaussian_flat(image: np.ndarray, dark=None) -> np.ndarray:
    """Псевдо светлое поле по одному снимку (уменьшенное, float32)."""
    small = _shrink(_without_dark(image, dark), GAUSSIAN_SIDE)
    sigma = max(small.shape[:2]) * GAUSSIAN_SIGMA_FRACTION
    background = small
    for _ in range(3):
        blur = cv2.GaussianBlur(background, (0, 0), sigma)
        # Объекты (темнее или светлее фона) заменяем текущей оценкой фона и размываем снова
        ratio = to_luminance(small) / np.maximum(to_luminance(blur), 1e-6)
        objects = np.abs(ratio - 1) > OBJECT_DEVIATION
        if small.ndim == 3:
            objects = objects[..., None]
        background = np.where(objects, blur, small)
    return _with_dark(cv2.GaussianBlur(background, (0, 0), sigma).astype(np.float32), dark)


def series_flat(images: List[np.ndarray], dark=None) -> Tuple[np.ndarray, List[str]]:
    """Светлое поле по серии снимков. Возвращает (оценка, предупреждения)."""
    if len(images) < MIN_SERIES:
        raise ValueError(t("est.min_series", min=MIN_SERIES, n=len(images)))
    warnings: List[str] = []
    if len(images) > MAX_SERIES:
        # Равномерная выборка: для оценки хватает, а память не раздувается
        step = len(images) / MAX_SERIES
        images = [images[int(i * step)] for i in range(MAX_SERIES)]

    first = _shrink(_without_dark(images[0], dark), MEDIAN_SIDE)
    h, w = first.shape[:2]
    color = first.ndim == 3
    reference_aspect = images[0].shape[1] / images[0].shape[0]
    stack = []
    for img in images:
        if abs(img.shape[1] / img.shape[0] - reference_aspect) > 0.01:
            warnings.append(t("est.size_mismatch"))
        small = _shrink(_without_dark(img, dark), MEDIAN_SIDE)
        if small.shape[:2] != (h, w):
            small = cv2.resize(small, (w, h), interpolation=cv2.INTER_AREA)
        if color and small.ndim == 2:
            small = np.repeat(small[..., None], 3, axis=2)
        elif not color and small.ndim == 3:
            small = to_luminance(small)
        stack.append(small)

    stack = np.stack(stack)
    lum = to_luminance(stack) if color else stack
    middle = np.median(lum, axis=0)
    # Объекты темнее фона (светлое поле) или светлее (флуоресценция)? Смотрим на хвосты:
    # там, где есть объекты, значения уходят далеко от медианы в одну сторону. По медиане
    # разброса решать нельзя — при редких клетках почти весь кадр фон, и решение случайно.
    dark_objects = np.percentile(middle - lum.min(axis=0), 99) >= np.percentile(lum.max(axis=0) - middle, 99)

    # Выравниваем экспозицию: если камера подбирала выдержку сама, снимки разной яркости
    # смешались бы в одной точке. Уровень фона — светлые значения для светлого поля,
    # темные — для флуоресценции.
    levels = np.array([np.percentile(frame, 90 if dark_objects else 10) for frame in lum])
    levels = np.maximum(levels, 1e-6)
    stack = stack * (levels.mean() / levels).reshape(-1, *([1] * (stack.ndim - 1)))

    rank = len(stack) - 2 if dark_objects else 1
    flat = np.sort(stack, axis=0)[rank].astype(np.float32)
    flat = _with_dark(cv2.GaussianBlur(flat, (0, 0), 1.0), dark)

    count = len(stack)
    if count < RELIABLE_SERIES:
        warnings.append(t("est.few", count=count))
    if structure_fraction(flat) > STRUCTURE_LIMIT:
        warnings.append(t("est.structure"))
    return flat, list(dict.fromkeys(warnings))


MAX_AVERAGE = 32


def average_stack(images: List[np.ndarray]) -> np.ndarray:
    """
    Среднее нескольких кадров калибровки (master flat / master dark).
    От 4 кадров в каждой точке отбрасываются минимум и максимум — так выбросы
    (горячий пиксель, пылинка, космическая частица) не портят результат.
    Считается полосами по строкам, результат во float32: усреднение дает дробную
    точность, которую нельзя терять округлением.
    """
    if len(images) < 2:
        raise ValueError(t("avg.min"))
    if len(images) > MAX_AVERAGE:
        raise ValueError(t("avg.max", max=MAX_AVERAGE, n=len(images)))
    shape = images[0].shape
    for img in images[1:]:
        if img.shape != shape:
            raise ValueError(
                t("avg.shape", a=f"{shape[1]}×{shape[0]}", b=f"{img.shape[1]}×{img.shape[0]}")
            )
    trim = len(images) >= 4
    out = np.empty(shape, np.float32)
    rows = max(1, 4_000_000 // (int(np.prod(shape[1:])) * len(images)))
    for y in range(0, shape[0], rows):
        strip = np.stack([finite(img[y : y + rows]) for img in images])
        if trim:
            strip.sort(axis=0)
            strip = strip[1:-1]
        out[y : y + rows] = strip.mean(axis=0)
    return out
