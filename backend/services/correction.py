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
from core import color, estimate, metrics
from core.flat_field import FlatProfile, apply_profile, build_profile, match_geometry, to_dtype
from schemas.processing import CorrectionSettings
from i18n import t

PREVIEW_MAX_SIDE = 1600
SOFTWARE = "MicroCleaner 2.0"
FORMULA = "C = max(R - D, 0) / max(F - D, 0.01 * mean(F - D)) * mean(F - D)"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def processing_log(
    source: Optional[Dict], bright: Optional[Dict], dark: Optional[Dict], settings: CorrectionSettings
) -> Dict:
    """Журнал преобразований: чем, по какой формуле и с какими параметрами получен файл."""
    log = {
        "software": SOFTWARE,
        "method": "flat-field correction",
        "formula": FORMULA,
        "source": source,
        "bright_field": bright,
        "dark_field": dark,
        "settings": settings.model_dump(),
        "note": t("log.note"),
    }
    estimated = (bright or {}).get("estimated")
    if estimated:
        log["approximate"] = True
        log["note"] = f"{estimated['note']} {log['note']}"
    return log


@dataclass
class Correction:
    image: np.ndarray
    white: float
    elapsed_ms: float
    warnings: List[str] = field(default_factory=list)


def calibration_warnings(raw: np.ndarray, bright: np.ndarray, dark: Optional[np.ndarray]) -> List[str]:
    warnings = []
    for what, calib in ((t("cal.what.bright"), bright), (t("cal.what.dark"), dark)):
        if calib is None:
            continue
        if calib.shape[:2] != raw.shape[:2]:
            warnings.append(
                t("cal.size", what=what, cw=calib.shape[1], ch=calib.shape[0], rw=raw.shape[1], rh=raw.shape[0])
            )
        if (calib.ndim == 3) != (raw.ndim == 3):
            warnings.append(t("cal.channels", what=what))
    return warnings


def thumbnail(image: np.ndarray, white: float, side: int = 360) -> str:
    return image_io.to_data_url(image_io.to_display_u8(image_io.resize_max(image, side), white), quality=82)


class CorrectionService:
    def __init__(self, profile_cache_size: int = 16):
        self._profiles: "OrderedDict[tuple, FlatProfile]" = OrderedDict()
        self._previews: "OrderedDict[tuple, tuple]" = OrderedDict()
        # Полноразмерный результат для пробы пикселя, линии и детального участка:
        # считается один раз на (снимок, калибровку, настройки), держим последние два
        self._results: "OrderedDict[tuple, Correction]" = OrderedDict()
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
    def correct(
        raw: np.ndarray, profile: FlatProfile, settings: CorrectionSettings, white: Optional[float] = None
    ) -> Correction:
        """
        FFC + цветокоррекция. Результат — в битности исходного снимка.
        white передается для уменьшенной копии, чтобы превью и полный размер
        нормировались одинаково.
        """
        start = time.perf_counter()
        white = white or color.white_level(raw)
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
        estimated: bool = False,
    ) -> Dict:
        small = image_io.resize_max(raw, PREVIEW_MAX_SIDE)
        small_profile, heatmap, warnings = self._preview_profile(
            key, raw, small.shape, bright, dark, settings, estimated
        )
        result = self.correct(small, small_profile, settings, color.white_level(raw))

        # Один и тот же уровень белого для «до» и «после» — честное сравнение
        before_u8 = image_io.to_display_u8(small, result.white)
        after_u8 = image_io.to_display_u8(result.image, result.white)
        return {
            "before": image_io.to_data_url(before_u8),
            "after": image_io.to_data_url(after_u8),
            "illumination_map": heatmap,
            "width": raw.shape[1],
            "height": raw.shape[0],
            "dtype": str(raw.dtype),
            "elapsed_ms": round(result.elapsed_ms, 2),
            "metrics": {"before": metrics.uniformity(small), "after": metrics.uniformity(result.image)},
            "warnings": warnings,
        }

    def _preview_profile(
        self, key, raw, small_shape, bright, dark, settings, estimated=False
    ) -> Tuple[FlatProfile, str, List[str]]:
        """
        Профиль, уже приведенный к размеру превью, карта освещенности и предупреждения.
        Зависят только от калибровки и размера снимка, поэтому кешируются: движение
        ползунков цветокоррекции не пересчитывает их на многомегапиксельных TIFF.
        """
        cache_key = None if key is None else (
            *key, settings.smoothing, settings.neutralize_color, raw.shape, small_shape
        )
        if cache_key is not None:
            with self._lock:
                if cache_key in self._previews:
                    self._previews.move_to_end(cache_key)
                    return self._previews[cache_key]

        profile = self.profile(key, bright, dark, settings)
        small_profile = FlatProfile(
            gain=match_geometry(profile.gain, small_shape),
            dark=None if profile.dark is None else match_geometry(profile.dark, small_shape),
        )
        entry = (
            small_profile,
            image_io.to_data_url(metrics.illumination_heatmap(profile.gain), "png"),
            # Оценка хранится уменьшенной — о несовпадении размера предупреждать незачем
            calibration_warnings(raw, None if estimated else bright, dark),
        )
        if cache_key is not None:
            with self._lock:
                self._previews[cache_key] = entry
                while len(self._previews) > self._cache_size:
                    self._previews.popitem(last=False)
        return entry

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
        metadata: Optional[Dict] = None,
        raw_id: Optional[str] = None,
    ) -> Tuple[bytes, str, str, Dict, Correction]:
        """
        Полноразмерная коррекция. Возвращает (байты, имя файла, MIME, отчет, результат).
        provenance — {"source", "bright_field", "dark_field"}: имена и SHA-256 входных файлов.
        metadata — метаданные исходного TIFF: переносятся в теги и записываются в журнал.
        raw_id — id загруженного кадра: результат берется из кеша, если его уже считали.
        """
        if raw_id is not None:
            result = self.full_result(raw_id, raw, bright, dark, settings, key)
        else:
            result = self.correct(raw, self.profile(key, bright, dark, settings), settings)
        fmt = fmt or image_io.format_for(raw_name)
        provenance = provenance or {"source": {"name": raw_name}, "bright_field": None, "dark_field": None}
        source = dict(provenance["source"] or {})
        if metadata:
            source["metadata"] = metadata
        log = processing_log(source, provenance["bright_field"], provenance["dark_field"], settings)
        data, mime = image_io.encode_image(result.image, fmt, result.white, json.dumps(log), metadata)
        report = {
            "elapsed_ms": round(result.elapsed_ms, 2),
            "before": metrics.uniformity(raw),
            "after": metrics.uniformity(result.image),
            "white": result.white,
            "source_sha256": source.get("sha256"),
            "source_metadata": metadata or None,
            "result_sha256": sha256(data),
        }
        return data, image_io.output_name(raw_name, fmt), mime, report, result

    def full_result(self, raw_id, raw, bright, dark, settings: CorrectionSettings, key) -> Correction:
        cache_key = (raw_id, key, settings.model_dump_json())
        with self._lock:
            if cache_key in self._results:
                self._results.move_to_end(cache_key)
                return self._results[cache_key]
        result = self.correct(raw, self.profile(key, bright, dark, settings), settings)
        with self._lock:
            self._results[cache_key] = result
            while len(self._results) > 2:
                self._results.popitem(last=False)
        return result

    def probe(self, raw_id, raw, bright, dark, settings, key, x: int, y: int) -> Dict:
        """Значения пикселя до и после коррекции в исходных единицах."""
        result = self.full_result(raw_id, raw, bright, dark, settings, key)
        h, w = raw.shape[:2]
        x, y = min(max(x, 0), w - 1), min(max(y, 0), h - 1)
        as_list = lambda v: np.atleast_1d(v).tolist()  # noqa: E731
        return {
            "x": x,
            "y": y,
            "channels": "rgb" if raw.ndim == 3 else "l",
            "before": as_list(raw[y, x]),
            "after": as_list(result.image[y, x]),
        }

    def crop(self, raw_id, raw, bright, dark, settings, key, x0, y0, x1, y1, max_side: int) -> Dict:
        """Участок в полном разрешении для просмотра при сильном увеличении."""
        result = self.full_result(raw_id, raw, bright, dark, settings, key)
        h, w = raw.shape[:2]
        x0, x1 = sorted((min(max(int(x0), 0), w - 1), min(max(int(x1), 1), w)))
        y0, y1 = sorted((min(max(int(y0), 0), h - 1), min(max(int(y1), 1), h)))
        x1, y1 = max(x1, x0 + 1), max(y1, y0 + 1)
        show = lambda img: image_io.to_data_url(  # noqa: E731
            image_io.to_display_u8(image_io.resize_max(img[y0:y1, x0:x1], max_side), result.white)
        )
        return {"x0": x0, "y0": y0, "x1": x1, "y1": y1, "before": show(raw), "after": show(result.image)}

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
        Серия снимков -> ZIP: результаты и processing.json.
        С bright — одна калибровка на всю серию. Без него светлое поле оценивается
        по каждому снимку отдельно (приблизительно, это пишется в журнал).
        calibration — {"bright_field": {...}, "dark_field": {...} | None}: имена и SHA-256.
        """
        calibration = calibration or {"bright_field": None, "dark_field": None}
        per_image = bright is None
        estimated = {"name": t("est.frame_gaussian"), "estimated": {"method": "gaussian", "note": t("est.gaussian_note")}}
        profile = None if per_image else self.profile(None, bright, dark, settings)
        files_log = []
        archive = io.BytesIO()
        used_names = set()

        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
            for name, data in raws:
                source = {"name": name, "sha256": sha256(data)}
                try:
                    raw = image_io.read_image(data, name)
                    meta = image_io.read_metadata(data, name)
                    if meta:
                        source["metadata"] = meta
                    if per_image:
                        file_profile = self.profile(None, estimate.gaussian_flat(raw, dark), dark, settings)
                    result = self.correct(raw, file_profile if per_image else profile, settings)
                    out_fmt = fmt or image_io.format_for(name)
                    bright_log = estimated if per_image else calibration["bright_field"]
                    log = processing_log(source, bright_log, calibration["dark_field"], settings)
                    encoded, _ = image_io.encode_image(
                        result.image, out_fmt, result.white, json.dumps(log), meta
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
            log = processing_log(
                None, estimated if per_image else calibration["bright_field"], calibration["dark_field"], settings
            )
            log["calibration"] = "per_image" if per_image else "shared"
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
