"""Проверка калибровочных кадров при загрузке: ошибки съемки лучше поймать до обработки серии."""
from typing import List

import cv2
import numpy as np

from core.color import white_level
from core.flat_field import to_luminance

SATURATED_LIMIT = 0.01      # доля пикселей в насыщении, после которой светлое поле считаем пересвеченным
DARK_BRIGHT_FIELD = 0.10    # медиана светлого поля ниже 10% диапазона — слишком темно
BRIGHT_DARK_FRAME = 0.25    # медиана темнового кадра выше 25% диапазона — это не темновой кадр
STRUCTURE_DEVIATION = 0.10  # локальное отклонение от тренда освещения, которое считаем «деталью»
STRUCTURE_LIMIT = 0.05      # пыль занимает ~1% площади, препарат — десятки процентов


def structure_fraction(image: np.ndarray) -> float:
    """
    Доля площади с мелкими деталями поверх плавного тренда освещения.
    В чистом светлом поле есть только виньетирование и редкие пятна пыли,
    а клетки или срез дают большую долю резких отклонений.
    """
    lum = to_luminance(image)
    h, w = lum.shape
    scale = min(1.0, 512 / max(h, w))
    small = cv2.resize(lum, (max(8, round(w * scale)), max(8, round(h * scale))), interpolation=cv2.INTER_AREA)
    fine = cv2.GaussianBlur(small, (0, 0), 1.5)
    trend = cv2.GaussianBlur(small, (0, 0), 25)
    deviation = np.abs(fine / np.maximum(trend, 1e-6) - 1)
    return float((deviation > STRUCTURE_DEVIATION).mean())


def check_bright(image: np.ndarray) -> List[str]:
    white = white_level(image)
    lum = to_luminance(image)
    issues = []

    saturated = image >= white * 0.995
    if saturated.ndim == 3:
        saturated = saturated.any(axis=2)
    share = float(saturated.mean())
    if share > SATURATED_LIMIT:
        issues.append(
            f"Светлое поле пересвечено: {share * 100:.1f}% пикселей в насыщении. "
            "В этих местах неравномерность не исправится — уменьшите экспозицию калибровки."
        )

    if float(np.median(lum)) < white * DARK_BRIGHT_FIELD:
        issues.append("Светлое поле слишком тёмное — коррекция будет шумной. Увеличьте экспозицию калибровки.")

    structure = structure_fraction(image)
    if structure > STRUCTURE_LIMIT:
        issues.append(
            f"В светлом поле видны мелкие детали ({structure * 100:.0f}% площади) — похоже на препарат "
            "или сильное загрязнение. Снимите калибровку на чистом участке стекла."
        )
    return issues


def check_dark(image: np.ndarray) -> List[str]:
    if float(np.median(to_luminance(image))) > white_level(image) * BRIGHT_DARK_FRAME:
        return ["Темновой кадр слишком светлый — возможно, затвор был открыт или перепутаны файлы."]
    return []


def check_frame(image: np.ndarray, role: str) -> List[str]:
    if role == "bright":
        return check_bright(image)
    if role == "dark":
        return check_dark(image)
    return []
