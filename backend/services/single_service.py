import time
from typing import Optional
from adapters.image_io import ImageIOAdapter
from domain.pipeline import ImageProcessingPipeline
from domain.flat_field import FlatFieldFilter
from schemas.processing import SingleCorrectionResponse


class SingleCorrectionService:
    """Сервис координации обработки одиночного микроснимка."""

    def __init__(self):
        # Настраиваем конвейер с фильтром Flat-Field
        self.pipeline = ImageProcessingPipeline()
        self.pipeline.add_filter(FlatFieldFilter())

    async def process(
        self,
        raw_bytes: bytes,
        raw_name: str,
        bright_bytes: bytes,
        bright_name: str,
        dark_bytes: Optional[bytes] = None,
        dark_name: Optional[str] = None
    ) -> SingleCorrectionResponse:
        """
        Считывает файлы, запускает таймер, проводит FFC-коррекцию и возвращает результат.
        """
        # 1. Читаем файлы через адаптер (автоматически понимает TIFF, PNG, JPG)
        raw_img = ImageIOAdapter.read_image_from_bytes(raw_bytes, raw_name)
        bright_img = ImageIOAdapter.read_image_from_bytes(bright_bytes, bright_name)
        dark_img = (
            ImageIOAdapter.read_image_from_bytes(dark_bytes, dark_name) 
            if dark_bytes else None
        )

        # 2. Засекаем время вычислений (требование ТЗ)
        start_time = time.perf_counter()

        # 3. Выполняем алгоритм через конвейер
        corrected_img = self.pipeline.execute(
            image=raw_img,
            bright_field=bright_img,
            dark_field=dark_img
        )

        # 4. Фиксируем время в миллисекундах
        execution_time = (time.perf_counter() - start_time) * 1000.0

        # 5. Преобразуем матрицу в Web-safe Base64 для шторки сравнения
        b64_preview = ImageIOAdapter.to_web_preview_base64(corrected_img)

        return SingleCorrectionResponse(
            status="success",
            message="Коррекция неравномерности освещения выполнена успешно",
            execution_time_ms=round(execution_time, 2),
            image_base64=b64_preview,
            original_shape=list(raw_img.shape[:2]),
            dtype=str(raw_img.dtype)
        )