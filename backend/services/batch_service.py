from typing import List, Tuple, Optional
import io
from adapters.image_io import ImageIOAdapter
from adapters.archiver import ZipArchiverAdapter
from domain.pipeline import ImageProcessingPipeline
from domain.flat_field import FlatFieldFilter


class BatchCorrectionService:
    """Сервис пакетной обработки массива микроснимков."""

    def __init__(self):
        self.pipeline = ImageProcessingPipeline()
        self.pipeline.add_filter(FlatFieldFilter())

    async def process_batch(
        self,
        raw_files: List[Tuple[str, bytes]],
        bright_bytes: bytes,
        bright_name: str,
        dark_bytes: Optional[bytes] = None,
        dark_name: Optional[str] = None
    ) -> io.BytesIO:
        """
        Прогоняет список снимков через FFC с единым калибровочным профилем
        и упаковывает результаты в ZIP.
        """
        # Калибровочные кадры читаем один раз (экономия ресурсов!)
        bright_img = ImageIOAdapter.read_image_from_bytes(bright_bytes, bright_name)
        dark_img = (
            ImageIOAdapter.read_image_from_bytes(dark_bytes, dark_name) 
            if dark_bytes else None
        )

        processed_files_for_zip = []

        # Обрабатываем каждый файл из пакета
        for filename, file_bytes in raw_files:
            raw_img = ImageIOAdapter.read_image_from_bytes(file_bytes, filename)
            
            # Применяем фильтр
            corrected_img = self.pipeline.execute(
                image=raw_img,
                bright_field=bright_img,
                dark_field=dark_img
            )

            # Сохраняем исходный формат (TIFF остается 16-битным TIFF, PNG остается PNG)
            out_bytes, out_name = ImageIOAdapter.save_image_to_bytes(corrected_img, filename)
            processed_files_for_zip.append((out_name, out_bytes))

        # Упаковываем все обработанные файлы в ZIP прямо в памяти
        return ZipArchiverAdapter.create_zip_archive(processed_files_for_zip)