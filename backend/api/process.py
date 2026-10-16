from typing import List, Optional
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse

from schemas.processing import SingleCorrectionResponse, ErrorResponse
from services.single_service import SingleCorrectionService
from services.batch_service import BatchCorrectionService

router = APIRouter(prefix="/process", tags=["Processing"])

# Создаем экземпляры сервисов
single_service = SingleCorrectionService()
batch_service = BatchCorrectionService()


@router.post(
    "/single", 
    response_model=SingleCorrectionResponse,
    responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}}
)
async def process_single_image(
    raw_image: UploadFile = File(..., description="Исходный микроснимок с неравномерным светом"),
    bright_image: UploadFile = File(..., description="Светлый калибровочный кадр (Bright Field)"),
    dark_image: Optional[UploadFile] = File(None, description="Темный калибровочный кадр (Dark Field)")
):
    """
    Эндпоинт для одиночного режима (MVP): 
    принимает снимки, выполняет коррекцию и возвращает превью в Base64 + замер времени.
    """
    try:
        raw_bytes = await raw_image.read()
        bright_bytes = await bright_image.read()
        dark_bytes = await dark_image.read() if dark_image else None

        result = await single_service.process(
            raw_bytes=raw_bytes,
            raw_name=raw_image.filename,
            bright_bytes=bright_bytes,
            bright_name=bright_image.filename,
            dark_bytes=dark_bytes,
            dark_name=dark_image.filename if dark_image else None
        )
        return result

    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Внутренняя ошибка сервера: {str(e)}")


@router.post("/batch")
async def process_batch_images(
    raw_images: List[UploadFile] = File(..., description="Пакет снимков (минимум 3 файла по ТЗ)"),
    bright_image: UploadFile = File(..., description="Калибровочный светлый кадр"),
    dark_image: Optional[UploadFile] = File(None, description="Калибровочный темный кадр")
):
    """
    Эндпоинт для пакетного режима:
    обрабатывает список снимков единым профилем и возвращает готовый ZIP-архив.
    """
    if len(raw_images) < 1:
        raise HTTPException(status_code=400, detail="Загрузите хотя бы один файл для пакетной обработки")

    try:
        # Считываем пакет исходников
        raw_files = []
        for upload in raw_images:
            content = await upload.read()
            raw_files.append((upload.filename, content))

        bright_bytes = await bright_image.read()
        dark_bytes = await dark_image.read() if dark_image else None

        zip_stream = await batch_service.process_batch(
            raw_files=raw_files,
            bright_bytes=bright_bytes,
            bright_name=bright_image.filename,
            dark_bytes=dark_bytes,
            dark_name=dark_image.filename if dark_image else None
        )

        # Отдаем файл как потоковый ZIP-архив на скачивание в браузер
        return StreamingResponse(
            zip_stream,
            media_type="application/zip",
            headers={"Content-Disposition": "attachment; filename=corrected_microscopy_results.zip"}
        )

    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка пакетной обработки: {str(e)}")