import io
import zipfile
from typing import List, Tuple


class ZipArchiverAdapter:
    """Адаптер для потоковой сборки ZIP-архивов в оперативной памяти."""

    @staticmethod
    def create_zip_archive(files: List[Tuple[str, bytes]]) -> io.BytesIO:
        """
        Принимает список кортежей (имя_файла, байты) и возвращает 
        поток BytesIO с готовым архивом.
        """
        zip_buffer = io.BytesIO()
        
        # Создаем архив со стандартным сжатием DEFLATE
        with zipfile.ZipFile(zip_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
            for filename, file_bytes in files:
                zf.writestr(filename, file_bytes)

        # Перемещаем указатель в начало буфера для последующей отдачи по сети
        zip_buffer.seek(0)
        return zip_buffer