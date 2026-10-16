from typing import List, Optional
from pydantic import BaseModel, Field


class SingleCorrectionResponse(BaseModel):
    """Схема успешного ответа при обработке одиночного снимка."""
    status: str = Field(default="success", description="Статус операции")
    message: str = Field(..., description="Понятное текстовое описание")
    execution_time_ms: float = Field(..., description="Время обработки в миллисекундах (ТЗ: показ времени)")
    image_base64: str = Field(..., description="Сжатое превью для шторки До/После в браузере")
    original_shape: List[int] = Field(..., description="Разрешение снимка [высота, ширина]")
    dtype: str = Field(..., description="Битность исходника (uint8 / uint16)")


class ErrorResponse(BaseModel):
    """Стандартизированная схема ошибки."""
    status: str = "error"
    detail: str