import numpy as np
import pytest

from core import color, demo, metrics
from core.flat_field import apply_profile, build_profile, flat_field_correct, match_geometry


def vignette(h=120, w=160, strength=0.6):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    r2 = ((xx - w / 2) ** 2 + (yy - h / 2) ** 2) / (w / 2) ** 2
    return 1.0 - strength * r2 / r2.max()


def test_uniform_specimen_becomes_flat():
    light = vignette()
    bright = (200 * light).astype(np.float32)
    raw = (100 * light).astype(np.float32)
    corrected = flat_field_correct(raw, bright)
    assert corrected.std() / corrected.mean() < 1e-4


def test_preserves_exposure_level():
    light = vignette()
    bright = 200 * light
    corrected = apply_profile(bright, build_profile(bright))
    assert corrected.mean() == pytest.approx(bright.mean(), rel=1e-4)


def test_dark_frame_is_subtracted():
    light = vignette()
    dark = np.full_like(light, 20.0)
    bright = dark + 200 * light
    raw = dark + 100 * light
    corrected = flat_field_correct(raw, bright, dark)
    assert corrected.std() < 1e-3
    # (R - D) / (F - D) = 0.5, m = mean(F - D) = 200 * mean(light)
    assert corrected.mean() == pytest.approx(100 * light.mean(), rel=1e-3)


def test_zero_bright_field_does_not_explode():
    bright = np.full((10, 10), 100, np.uint8)
    bright[0, 0] = 0
    raw = np.full((10, 10), 50, np.uint8)
    corrected = flat_field_correct(raw, bright)
    assert np.isfinite(corrected).all()
    assert corrected.dtype == np.uint8


@pytest.mark.parametrize("dtype", [np.uint8, np.uint16, np.float32])
def test_dtype_is_preserved(dtype):
    light = vignette()
    scale = {np.uint8: 200, np.uint16: 50000, np.float32: 0.8}[dtype]
    bright = (scale * light).astype(dtype)
    raw = (scale * 0.5 * light).astype(dtype)
    assert flat_field_correct(raw, bright).dtype == dtype


def test_sixteen_bit_range_is_not_clipped_to_8_bit():
    light = vignette()
    bright = (40000 * light).astype(np.uint16)
    corrected = flat_field_correct(bright, bright)
    assert corrected.max() > 255


def test_neutralize_removes_color_cast():
    light = vignette()[..., None] * np.array([1.0, 0.9, 0.7], np.float32)
    bright = 220 * light
    neutral = flat_field_correct(bright, bright, neutralize_color=True)
    tinted = flat_field_correct(bright, bright, neutralize_color=False)
    assert np.ptp(neutral.reshape(-1, 3).mean(0)) < 1e-3
    assert np.ptp(tinted.reshape(-1, 3).mean(0)) > 10


def test_calibration_geometry_is_matched():
    assert match_geometry(np.ones((60, 80), np.float32), (120, 160, 3)).shape == (120, 160, 3)
    assert match_geometry(np.ones((120, 160, 3), np.float32), (120, 160)).shape == (120, 160)


def test_metrics_show_improvement_on_demo():
    raw, bright, dark = demo.generate("sample-1"), demo.generate("bright"), demo.generate("dark")
    corrected = flat_field_correct(raw, bright, dark)
    before, after = metrics.uniformity(raw), metrics.uniformity(corrected)
    assert after["nonuniformity"] < before["nonuniformity"] / 3
    assert abs(after["vignetting"] - 100) < abs(before["vignetting"] - 100)


def test_white_level_detects_effective_bit_depth():
    assert color.white_level(np.array([0, 4000], np.uint16)) == 4095
    assert color.white_level(np.array([0, 200], np.uint8)) == 255


def test_color_identity_and_clipping():
    x = np.random.default_rng(0).random((8, 8, 3)).astype(np.float32)
    assert np.allclose(color.apply_color(x), x)
    out = color.apply_color(x, exposure=2, contrast=2, saturation=2)
    assert out.min() >= 0 and out.max() <= 1


def test_nan_and_inf_are_sanitized():
    bright = vignette().astype(np.float32)
    bright[0, 0], bright[1, 1] = np.nan, np.inf
    raw = 0.5 * bright
    raw[2, 2] = -np.inf
    corrected = flat_field_correct(raw, bright)
    assert np.isfinite(corrected).all()


def test_result_is_reproducible():
    raw, bright, dark = demo.generate("sample-3"), demo.generate("bright"), demo.generate("dark")
    first = flat_field_correct(raw, bright, dark)
    second = flat_field_correct(raw.copy(), bright.copy(), dark.copy())
    assert np.array_equal(first, second)


def test_source_pixels_are_not_modified():
    raw, bright = demo.generate("sample-1"), demo.generate("bright")
    snapshot = raw.copy()
    flat_field_correct(raw, bright)
    assert np.array_equal(raw, snapshot)


def _series(n):
    """Серия снимков разных полей зрения с одинаковой засветкой (как с одного микроскопа)."""
    optics = demo._optics()
    dark = demo._dark(np.random.default_rng(11))
    return [
        demo._to_u8(dark + demo.BRIGHT_LEVEL * optics * demo._specimen(s), np.random.default_rng(300 + s))
        for s in range(1, n + 1)
    ]


def test_series_flat_matches_real_calibration():
    from core import estimate
    from core.flat_field import apply_profile, build_profile, to_dtype

    series = _series(10)
    flat, warnings = estimate.series_flat(series)
    estimated = to_dtype(apply_profile(series[0], build_profile(flat)), np.uint8)
    real = flat_field_correct(series[0], demo.generate("bright"), demo.generate("dark"))
    assert warnings == []
    assert metrics.uniformity(estimated)["nonuniformity"] < metrics.uniformity(real)["nonuniformity"] + 1


def test_series_flat_needs_enough_images():
    from core import estimate

    with pytest.raises(ValueError):
        estimate.series_flat(_series(3))
    _, warnings = estimate.series_flat(_series(5))
    assert any("Снимков всего 5" in w for w in warnings)


def test_gaussian_flat_is_approximate_but_helps():
    from core import estimate
    from core.flat_field import apply_profile, build_profile, to_dtype

    raw = _series(1)[0]
    corrected = to_dtype(apply_profile(raw, build_profile(estimate.gaussian_flat(raw))), np.uint8)
    before, after = metrics.uniformity(raw), metrics.uniformity(corrected)
    assert after["nonuniformity"] < before["nonuniformity"] / 4


def test_series_flat_has_no_cell_ghosts():
    # 6 снимков: часть клеток лежит в одном месте на половине снимков. Медиана оставляла
    # на этих местах «призраки» клеток (худшая ошибка ~14%), фоновое значение — нет.
    from core import estimate
    from core.flat_field import apply_profile, build_profile

    series = _series(6)
    dark = demo.generate("dark")
    real = apply_profile(series[0], build_profile(demo.generate("bright"), dark))
    flat, _ = estimate.series_flat(series)
    corrected = apply_profile(series[0], build_profile(flat, dark))
    corrected *= np.median(real) / np.median(corrected)
    worst = np.percentile(np.abs(corrected - real), 99.9) / 255 * 100
    assert worst < 8


def _hot_pixel_error(corrected, truth, hot):
    corrected = corrected * (np.median(truth) / np.median(corrected))
    return float(np.abs(corrected - truth)[hot].mean()) / 255 * 100


def test_estimates_with_dark_frame_remove_hot_pixels():
    # Оценка светлого поля уменьшена; темновой кадр должен вычитаться из снимка в полном
    # разрешении, иначе горячие пиксели размазываются и остаются (было 38–48% ошибки)
    from core import estimate
    from core.flat_field import apply_profile, build_profile, to_luminance

    light = demo.BRIGHT_LEVEL * demo._optics()
    dark = demo.generate("dark")
    hot = to_luminance(dark) > 30
    series = _series(8)
    truth = demo._specimen(1) * float(light.mean())

    real = apply_profile(series[0], build_profile(demo.generate("bright"), dark))
    single = apply_profile(series[0], build_profile(estimate.gaussian_flat(series[0], dark), dark))
    from_series = apply_profile(series[0], build_profile(estimate.series_flat(series, dark)[0], dark))
    assert _hot_pixel_error(real, truth, hot) < 2
    assert _hot_pixel_error(single, truth, hot) < 3
    assert _hot_pixel_error(from_series, truth, hot) < 3


def test_series_flat_handles_sparse_cells_and_exposure():
    # Редкие клетки: направление объектов определяется по хвостам, а не по медиане.
    # Разная экспозиция: снимки выравниваются перед оценкой.
    from core import estimate
    from core.flat_field import apply_profile, build_profile

    optics, dark = demo._optics(), demo._dark(np.random.default_rng(11))
    light = demo.BRIGHT_LEVEL * optics
    rng = np.random.default_rng(3)
    specimens, shots = [], []
    for i in range(6):
        T = np.ones((demo.HEIGHT, demo.WIDTH, 3), np.float32)
        for _ in range(3):
            centre = (int(rng.integers(0, demo.WIDTH)), int(rng.integers(0, demo.HEIGHT)))
            demo._stain(T, centre, (30, 22), 0.0, (0.9, 0.55, 0.75), 1.6)
        exposure = float(rng.uniform(0.75, 1.25))
        specimens.append(T)
        shots.append((demo._to_u8(dark + light * T * exposure, np.random.default_rng(i)), exposure))
    dark_frame = demo.generate("dark")
    flat, _ = estimate.series_flat([s for s, _ in shots], dark_frame)
    corrected = apply_profile(shots[0][0], build_profile(flat, dark_frame)) / shots[0][1]
    truth = specimens[0] * float(light.mean())
    corrected *= np.median(truth) / np.median(corrected)
    assert metrics.uniformity(np.clip(corrected, 0, 255))["nonuniformity"] < 4
    assert np.percentile(np.abs(corrected - truth), 99.9) / 255 * 100 < 8
