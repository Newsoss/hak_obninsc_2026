"""
Проверка метода на эталоне: известный чистый снимок «снимается» через оптику
с виньетированием, пылью и оттенком, исправляется и сравнивается с оригиналом.
Так видно, насколько точно метод восстанавливает снимок, — в числах.
"""
from typing import Dict, Optional

import numpy as np

from adapters import image_io
from core import demo, estimate, metrics
from core.flat_field import apply_profile, build_profile
from i18n import t

PASS_ERROR = 1.5  # средняя ошибка, % диапазона, при которой метод считаем корректным


def _compare(image: np.ndarray, truth: np.ndarray) -> Dict:
    diff = np.clip(image.astype(np.float32), 0, 255) - truth
    rmse = float(np.sqrt(np.mean(diff ** 2)))
    return {
        "mean_error": round(float(np.mean(np.abs(diff))) / 255 * 100, 2),
        "max_error": round(float(np.percentile(np.abs(diff), 99.9)) / 255 * 100, 1),
        "psnr": round(float(20 * np.log10(255 / max(rmse, 1e-6))), 1),
        "nonuniformity": metrics.uniformity(image)["nonuniformity"],
    }


def _picture(image: np.ndarray) -> str:
    return image_io.to_data_url(np.clip(image_io.resize_max(image, 480), 0, 255).astype(np.uint8), quality=85)


def verify(specimen: Optional[np.ndarray] = None, name: Optional[str] = None) -> Dict:
    transmittance = demo.specimen_from_image(specimen) if specimen is not None else demo.builtin_specimen(1)
    shot = demo.simulate(transmittance)
    raw, truth = shot["raw"], shot["truth"]

    with_flat = apply_profile(raw, build_profile(shot["bright"], shot["dark"]))
    without_flat = apply_profile(raw, build_profile(estimate.gaussian_flat(raw), shot["dark"]))

    rows = [
        {"id": "none", "method": t("verify.none"), **_compare(raw.astype(np.float32) - shot["dark"], truth)},
        {"id": "flat", "method": t("verify.flat"), **_compare(with_flat, truth)},
        {"id": "gaussian", "method": t("verify.gaussian"), **_compare(without_flat, truth)},
    ]
    error = rows[1]["mean_error"]
    passed = error <= PASS_ERROR
    return {
        "specimen": name or t("verify.builtin"),
        "passed": passed,
        "verdict": t("verify.pass", error=error) if passed else t("verify.fail", error=error, limit=PASS_ERROR),
        "rows": rows,
        "images": {"truth": _picture(truth), "raw": _picture(raw), "corrected": _picture(with_flat)},
    }
