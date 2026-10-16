import numpy as np
import cv2

def apply_flat_field(raw: np.ndarray, flat: np.ndarray, dark: np.ndarray = None) -> np.ndarray:
    # Приводим к float32 для точных вычислений без переполнения
    raw_f = raw.astype(np.float32)
    flat_f = flat.astype(np.float32)
    
    if dark is None:
        dark_f = np.zeros_like(raw_f)
    else:
        dark_f = dark.astype(np.float32)

    # Вычитаем темновой шум
    raw_sub = raw_f - dark_f
    flat_sub = flat_f - dark_f

    # ЗАЩИТА: избегаем деления на ноль (заменяем 0 на очень маленькое число)
    flat_sub[flat_sub <= 0] = 1e-6

    # Вычисляем среднюю яркость фона для сохранения исходной экспозиции
    m = np.mean(flat_sub)

    # Формула коррекции
    corrected = (raw_sub / flat_sub) * m

    # ЗАЩИТА: обрезаем недопустимые диапазоны значений (0-255 для 8-bit)
    # Если работаете с 16-bit TIFF, замените 255 на 65535
    corrected = np.clip(corrected, 0, 255)
    
    return corrected.astype(np.uint8)