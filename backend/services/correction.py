"""Сценарии обработки: превью, экспорт одного снимка и пакетная обработка."""
import hashlib
import io
import json
import threading
import time
import zipfile
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

from adapters import image_io
from core import color, metrics
from core.flat_field import FlatProfile, apply_profile, build_profile, to_dtype
from schemas.processing import CorrectionSettings

PREVIEW_MAX_SIDE = 1600
SOFTWARE = "MicroCleaner 2.0"
FORMULA = "C = max(R - D, 0) / max(F - D, 0.01 * mean(F - D)) * mean(F - D)"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def processing_log(
    source: Optional[Dict], bright: Optional[Dict], dark: Optional[Dict], settings: CorrectionSettings
) -> Dict:
    """Журнал преобразований: чем, по какой формуле и с какими параметрами получен файл."""
    return {
        "software": SOFTWARE,
        "method": "flat-field correction",
        "formula": FORMULA,
        "source": source,
        "bright_field": bright,
        "dark_field": dark,
        "settings": settings.model_dump(),
        "note": "Исследовательская обработка. Исходный файл не изменяется и хранится отдельно.",
    }


@dataclass
class Correction:
    image: np.ndarray
    white: float
    elapsed_ms: float
    warnings: List[str] = field(default_factory=list)


def calibration_warnings(raw: np.ndarray, bright: np.ndarray, dark: Optional[np.ndarray]) -> List[str]:
    warnings = []
    for label, calib in (("светлого поля", bright), ("темнового кадра", dark)):
        if calib is None:
            continue
        if calib.shape[:2] != raw.shape[:2]:
            warnings.append(
                f"Размер {label} {calib.shape[1]}×{calib.shape[0]} не совпадает со снимком "
                f"{raw.shape[1]}×{raw.shape[0]} — кадр масштабирован"
            )
        if (calib.ndim == 3) != (raw.ndim == 3):
            warnings.append(f"Число каналов {label} отличается от снимка — каналы приведены")
    if bright is not None and float(np.median(bright)) < color.white_level(bright) * 0.1:
        warnings.append("Светлое поле очень темное — коррекция будет шумной")
    return warnings


class CorrectionService:
    def __init__(self, profile_cache_size: int = 16):
        self._profiles: "OrderedDict[tuple, FlatProfile]" = OrderedDict()
        self._cache_size = profile_cache_size
        self._lock = threading.Lock()

    def profile(
        self,
        key: Optional[tuple],
        bright: np.ndarray,
        dark: Optional[np.ndarray],
        settings: CorrectionSettings,
    ) -> FlatProfile:
        """Профиль строится один раз на (калибровка, настройки) и кешируется."""
        full_key = None if key is None else (*key, settings.smoothing, settings.neutralize_color)
        if full_key is not None:
            with self._lock:
                if full_key in self._profiles:
                    self._profiles.move_to_end(full_key)
                    return self._profiles[full_key]

        profile = build_profile(bright, dark, settings.smoothing, settings.neutralize_color)

        if full_key is not None:
            with self._lock:
                self._profiles[full_key] = profile
                while len(self._profiles) > self._cache_size:
                    self._profiles.popitem(last=False)
        return profile

    @staticmethod
    def correct(raw: np.ndarray, profile: FlatProfile, settings: CorrectionSettings) -> Correction:
        """FFC + цветокоррекция. Результат — в битности исходного снимка."""
        start = time.perf_counter()
        white = color.white_level(raw)
        corrected = apply_profile(raw, profile)

        params = settings.color.model_dump()
        if not color.is_identity(**params):
            corrected = color.apply_color(corrected / white, **params) * white

        result = to_dtype(corrected, raw.dtype)
        return Correction(result, white, (time.perf_counter() - start) * 1000)

    def preview(
        self,
        raw: np.ndarray,
        bright: np.ndarray,
        dark: Optional[np.ndarray],
        settings: CorrectionSettings,
        key: Optional[tuple] = None,
    ) -> Dict:
        profile = self.profile(key, bright, dark, settings)
        small = image_io.resize_max(raw, PREVIEW_MAX_SIDE)
        result = self.correct(small, profile, settings)

        # Один и тот же уровень белого для «до» и «после» — честное сравнение
        before_u8 = image_io.to_display_u8(small, result.white)
        after_u8 = image_io.to_display_u8(result.image, result.white)
        return {
            "before": image_io.to_data_url(before_u8),
            "after": image_io.to_data_url(after_u8),
            "illumination_map": image_io.to_data_url(metrics.illumination_heatmap(profile.gain), "png"),
            "width": raw.shape[1],
            "height": raw.shape[0],
            "dtype": str(raw.dtype),
            "elapsed_ms": round(result.elapsed_ms, 2),
            "metrics": {"before": metrics.uniformity(small), "after": metrics.uniformity(result.image)},
            "histograms": {"before": metrics.histogram(before_u8), "after": metrics.histogram(after_u8)},
            "warnings": calibration_warnings(raw, bright, dark),
        }

    def export(
        self,
        raw: np.ndarray,
        raw_name: str,
        bright: np.ndarray,
        dark: Optional[np.ndarray],
        settings: CorrectionSettings,
        fmt: Optional[str] = None,
        key: Optional[tuple] = None,
        provenance: Optional[Dict] = None,
    ) -> Tuple[bytes, str, str, Dict]:
        """
        Полноразмерная коррекция. Возвращает (байты, имя файла, MIME, отчет).
        provenance — {"source", "bright_field", "dark_field"}: имена и SHA-256 входных файлов.
        """
        profile = self.profile(key, bright, dark, settings)
        result = self.correct(raw, profile, settings)
        fmt = fmt or image_io.format_for(raw_name)
        provenance = provenance or {"source": {"name": raw_name}, "bright_field": None, "dark_field": None}
        log = processing_log(provenance["source"], provenance["bright_field"], provenance["dark_field"], settings)
        data, mime = image_io.encode_image(result.image, fmt, result.white, json.dumps(log))
        report = {
            "elapsed_ms": round(result.elapsed_ms, 2),
            "before": metrics.uniformity(raw),
            "after": metrics.uniformity(result.image),
            "source_sha256": (provenance["source"] or {}).get("sha256"),
            "result_sha256": sha256(data),
        }
        return data, image_io.output_name(raw_name, fmt), mime, report

    def batch(
        self,
        raws: Sequence[Tuple[str, bytes]],
        bright: np.ndarray,
        dark: Optional[np.ndarray],
        settings: CorrectionSettings,
        fmt: Optional[str] = None,
        calibration: Optional[Dict] = None,
    ) -> io.BytesIO:
        """
        Серия снимков одним профилем -> ZIP: результаты и processing.json.
        calibration — {"bright_field": {...}, "dark_field": {...} | None}: имена и SHA-256.
        """
        calibration = calibration or {"bright_field": None, "dark_field": None}
        profile = self.profile(None, bright, dark, settings)
        files_log = []
        archive = io.BytesIO()
        used_names = set()

        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
            for name, data in raws:
                source = {"name": name, "sha256": sha256(data)}
                try:
                    raw = image_io.read_image(data, name)
                    result = self.correct(raw, profile, settings)
                    out_fmt = fmt or image_io.format_for(name)
                    log = processing_log(source, calibration["bright_field"], calibration["dark_field"], settings)
                    encoded, _ = image_io.encode_image(
                        result.image, out_fmt, result.white, json.dumps(log)
                    )
                    out_name = _unique(image_io.output_name(name, out_fmt), used_names)
                    zf.writestr(out_name, encoded)
                    entry = {
                        "source": source,
                        "output": out_name,
                        "result_sha256": sha256(encoded),
                        "elapsed_ms": round(result.elapsed_ms, 2),
                        "before": metrics.uniformity(raw),
                        "after": metrics.uniformity(result.image),
                    }
                    files_log.append(entry)
                except ValueError as exc:
                    files_log.append({"source": source, "error": str(exc)})
            log = processing_log(None, calibration["bright_field"], calibration["dark_field"], settings)
            del log["source"]
            log["files"] = files_log
            zf.writestr("processing.json", json.dumps(log, ensure_ascii=False, indent=2))

        archive.seek(0)
        return archive


def _unique(name: str, used: set) -> str:
    candidate, index = name, 1
    while candidate in used:
        stem, _, ext = name.rpartition(".")
        candidate = f"{stem}_{index}.{ext}"
        index += 1
    used.add(candidate)
    return candidate
