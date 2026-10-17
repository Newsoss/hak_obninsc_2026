from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class ColorSettings(BaseModel):
    """Тонкая цветокоррекция (применяется после выравнивания освещения)."""

    exposure: float = Field(0.0, ge=-3, le=3, description="Экспокоррекция, ступени EV")
    brightness: float = Field(0.0, ge=-0.5, le=0.5, description="Сдвиг яркости")
    contrast: float = Field(1.0, ge=0.2, le=3.0, description="Множитель контраста")
    gamma: float = Field(1.0, ge=0.2, le=3.0, description="Гамма")
    saturation: float = Field(1.0, ge=0.0, le=3.0, description="Насыщенность")
    temperature: float = Field(0.0, ge=-1, le=1, description="Теплее (+) / холоднее (-)")
    tint: float = Field(0.0, ge=-1, le=1, description="Пурпурный (+) / зеленый (-)")
    auto_white_balance: bool = Field(False, description="Автобаланс белого (серый мир)")
    auto_levels: bool = Field(False, description="Автоуровни 0.5–99.5 перцентиль")


class CorrectionSettings(BaseModel):
    """Профиль обработки: одинаково применяется ко всем снимкам серии."""

    neutralize_color: bool = Field(True, description="Убрать цветовой оттенок осветителя")
    smoothing: float = Field(0.0, ge=0, le=50, description="Сглаживание светлого поля, сигма в px")
    color: ColorSettings = Field(default_factory=ColorSettings)


class FrameInfo(BaseModel):
    id: str
    name: str
    width: int
    height: int
    channels: int
    dtype: str
    bit_depth: int
    sha256: str = Field(..., description="SHA-256 исходного файла")
    thumbnail: str
    checks: List[str] = Field(default_factory=list, description="Замечания к калибровочному кадру")
    metadata: Optional[Dict] = Field(None, description="Метаданные исходного TIFF")
    estimated: Optional[Dict] = Field(None, description="Светлое поле не снято, а оценено: способ и пояснение")
    averaged: Optional[Dict] = Field(None, description="Кадр — среднее нескольких: число кадров и снижение шума")


class FrameRefs(BaseModel):
    raw_id: str
    bright_id: Optional[str] = Field(
        None, description="Светлое поле. Если не задано — оценивается по самому снимку (приблизительно)"
    )
    dark_id: Optional[str] = None
    settings: CorrectionSettings = Field(default_factory=CorrectionSettings)


class ExportRequest(FrameRefs):
    format: Optional[Literal["tiff", "png", "jpeg"]] = None


class ProbeRequest(FrameRefs):
    x: int = Field(..., ge=0, description="Столбец пикселя в полном разрешении")
    y: int = Field(..., ge=0, description="Строка пикселя в полном разрешении")


class CropRequest(FrameRefs):
    x0: float
    y0: float
    x1: float
    y1: float
    max_side: int = Field(1600, ge=64, le=4096)


class Uniformity(BaseModel):
    nonuniformity: float = Field(..., description="Коэффициент вариации освещенности, %")
    vignetting: float = Field(..., description="Яркость углов относительно центра, %")


class PreviewResponse(BaseModel):
    before: str
    after: str
    illumination_map: str
    width: int
    height: int
    dtype: str
    elapsed_ms: float
    metrics: Dict[str, Uniformity]
    warnings: List[str] = []
    approximate: Optional[str] = Field(None, description="Пояснение, если светлое поле оценено, а не снято")
