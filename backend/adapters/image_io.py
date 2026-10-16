import io
import base64
from typing import Tuple
import numpy as np
import cv2
import tifffile


class ImageIOAdapter:
    """Адаптер для безопасного чтения и сохранения изображений различных научных форматов."""

    @staticmethod
    def read_image_from_bytes(file_bytes: bytes, filename: str) -> np.ndarray:
        """
        Универсально читает байты файла в numpy-матрицу.
        Для TIFF использует специализированный движок tifffile, для остальных — OpenCV.
        """
        filename_lower = filename.lower()
        
        try:
            if filename_lower.endswith(('.tif', '.tiff')):
                # Чтение через tifffile (поддерживает 16-бит, 32-бит, плавающую точку)
                with io.BytesIO(file_bytes) as bio:
                    image = tifffile.imread(bio)
            else:
                # Чтение стандартных форматов (PNG, JPG, BMP)
                np_arr = np.frombuffer(file_bytes, np.uint8)
                image = cv2.imdecode(np_arr, cv2.IMREAD_UNCHANGED)

            if image is None:
                raise ValueError("Файл поврежден или имеет неподдерживаемую кодировку пикселей")

            return image

        except Exception as e:
            raise ValueError(f"Ошибка при чтении файла {filename}: {str(e)}")

    @staticmethod
    def to_web_preview_base64(image: np.ndarray) -> str:
        """
        Преобразует матрицу любого типа (включая 16-битный TIFF) 
        в 8-битный PNG Base64 для отображения в браузере (шторке До/После).
        """
        # Если снимок 16-битный или вещественный, нормируем его в 8-бит [0..255] для браузера
        if image.dtype == np.uint16:
            # Линейное сжатие диапазона 0..65535 в 0..255
            preview = (image / 256).astype(np.uint8)
        elif np.issubdtype(image.dtype, np.floating):
            preview = np.clip(image * 255.0, 0, 255).astype(np.uint8)
        else:
            preview = image.astype(np.uint8)

        # Кодируем в PNG
        success, encoded = cv2.imencode('.png', preview)
        if not success:
            raise RuntimeError("Не удалось сжать изображение для превью")

        b64_str = base64.b64encode(encoded).decode('utf-8')
        return f"data:image/png;base64,{b64_str}"

    @staticmethod
    def save_image_to_bytes(image: np.ndarray, original_filename: str) -> Tuple[bytes, str]:
        """
        Сохраняет матрицу в байты с сохранением оригинальной битности и формата.
        Используется при отдаче файлов в ZIP-архиве.
        """
        ext = original_filename.split('.')[-1].lower()
        output_filename = f"corrected_{original_filename}"

        if ext in ['tif', 'tiff']:
            bio = io.BytesIO()
            tifffile.imwrite(bio, image)
            return bio.getvalue(), output_filename
        else:
            # Для PNG/JPG используем OpenCV
            target_ext = f".{ext}" if ext in ['png', 'jpg', 'jpeg'] else '.png'
            success, encoded = cv2.imencode(target_ext, image)
            if not success:
                raise RuntimeError(f"Не удалось закодировать изображение в {target_ext}")
            return encoded.tobytes(), output_filename