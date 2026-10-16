import io
import json
import zipfile

import numpy as np
import pytest
import tifffile
from fastapi.testclient import TestClient

from adapters import image_io
from main import app

client = TestClient(app)


def upload(content: bytes, name: str) -> dict:
    response = client.post("/api/frames", files={"file": (name, content)})
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture(scope="module")
def demo_ids():
    ids = {}
    for name in ("bright", "dark", "sample-1"):
        png = client.get(f"/api/demo/{name}.png").content
        ids[name] = upload(png, f"{name}.png")["id"]
    return ids


def test_health():
    assert client.get("/api/health").json()["status"] == "ok"


def test_preview_improves_uniformity(demo_ids):
    response = client.post(
        "/api/process/preview",
        json={"raw_id": demo_ids["sample-1"], "bright_id": demo_ids["bright"], "dark_id": demo_ids["dark"]},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["after"].startswith("data:image/jpeg;base64,")
    assert body["metrics"]["after"]["nonuniformity"] < body["metrics"]["before"]["nonuniformity"]
    assert body["illumination_map"].startswith("data:image/png;base64,")


def test_export_keeps_format(demo_ids):
    response = client.post(
        "/api/process/export",
        json={"raw_id": demo_ids["sample-1"], "bright_id": demo_ids["bright"], "format": "tiff",
              "settings": {"color": {"gamma": 1.2}}},
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/tiff"
    assert "sample-1_ffc.tif" in response.headers["content-disposition"]
    assert "after" in json.loads(response.headers["x-correction-report"])
    assert tifffile.imread(io.BytesIO(response.content)).shape == (960, 1280, 3)


def test_sixteen_bit_tiff_roundtrip():
    rng = np.random.default_rng(1)
    bright = (30000 + rng.normal(0, 50, (64, 80))).astype(np.uint16)
    raw = (bright * 0.5).astype(np.uint16)
    bright_id = upload(image_io.encode_image(bright, "tiff")[0], "bright.tif")["id"]
    response = client.post(
        "/api/process/file",
        files={"raw": ("raw.tif", image_io.encode_image(raw, "tiff")[0])},
        data={"bright_id": bright_id},
    )
    assert response.status_code == 200, response.text
    result = tifffile.imread(io.BytesIO(response.content))
    assert result.dtype == np.uint16 and result.max() > 255


def test_batch_zip_contents():
    bright = client.get("/api/demo/bright.png").content
    samples = [client.get(f"/api/demo/sample-{i}.png").content for i in (1, 2, 3)]
    files = [("raw_images", (f"s{i}.png", data)) for i, data in enumerate(samples)]
    files += [("raw_images", ("broken.png", b"not an image")), ("bright_image", ("bright.png", bright))]
    response = client.post("/api/process/batch", files=files, data={"settings": '{"neutralize_color": true}'})
    assert response.status_code == 200, response.text
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    assert set(archive.namelist()) == {"s0_ffc.png", "s1_ffc.png", "s2_ffc.png", "processing.json"}
    log = json.loads(archive.read("processing.json"))
    broken = next(f for f in log["files"] if f["source"]["name"] == "broken.png")
    assert "error" in broken


def test_errors_are_readable():
    assert client.post("/api/frames", files={"file": ("x.png", b"garbage")}).status_code == 400
    assert client.post("/api/frames", files={"file": ("x.gif", b"GIF89a")}).status_code == 400
    response = client.post("/api/process/preview", json={"raw_id": "nope", "bright_id": "nope"})
    assert response.status_code == 404
    assert client.get("/api/demo/unknown.png").status_code == 404


def test_export_is_byte_identical_and_documented(demo_ids):
    body = {"raw_id": demo_ids["sample-1"], "bright_id": demo_ids["bright"], "dark_id": demo_ids["dark"],
            "format": "tiff", "settings": {"color": {"contrast": 1.2}}}
    first, second = client.post("/api/process/export", json=body), client.post("/api/process/export", json=body)
    assert first.content == second.content
    log = json.loads(tifffile.TiffFile(io.BytesIO(first.content)).pages[0].description)
    assert log["method"] == "flat-field correction"
    assert log["source"]["name"] == "sample-1.png" and len(log["source"]["sha256"]) == 64
    assert log["dark_field"]["name"] == "dark.png"
    assert log["settings"]["color"]["contrast"] == 1.2
    report = json.loads(first.headers["x-correction-report"])
    assert report["source_sha256"] == log["source"]["sha256"]
    assert first.headers["content-disposition"].endswith("sample-1_ffc.tif")


def test_batch_contains_processing_log():
    bright = client.get("/api/demo/bright.png").content
    files = [("raw_images", (f"s{i}.png", client.get(f"/api/demo/sample-{i}.png").content)) for i in (1, 2, 3)]
    files.append(("bright_image", ("bright.png", bright)))
    archive = zipfile.ZipFile(io.BytesIO(client.post("/api/process/batch", files=files).content))
    log = json.loads(archive.read("processing.json"))
    assert log["bright_field"]["name"] == "bright.png"
    assert [f["output"] for f in log["files"]] == ["s1_ffc.png", "s2_ffc.png", "s3_ffc.png"]


def refs(demo_ids, **extra):
    return {"raw_id": demo_ids["sample-1"], "bright_id": demo_ids["bright"], "dark_id": demo_ids["dark"], **extra}


def test_probe_returns_raw_units(demo_ids):
    body = client.post("/api/process/probe", json=refs(demo_ids, x=5, y=5)).json()
    assert body["channels"] == "rgb" and len(body["before"]) == 3 and len(body["after"]) == 3
    assert all(isinstance(v, int) for v in body["before"] + body["after"])


def test_crop_full_resolution(demo_ids):
    body = client.post("/api/process/crop", json=refs(demo_ids, x0=100, y0=50, x1=300, y1=150)).json()
    assert (body["x0"], body["y0"], body["x1"], body["y1"]) == (100, 50, 300, 150)
    assert body["before"].startswith("data:image/jpeg") and body["after"].startswith("data:image/jpeg")


def test_calibration_checks_on_upload():
    bright = client.get("/api/demo/bright.png").content
    sample = client.get("/api/demo/sample-1.png").content
    ok = client.post("/api/frames?role=bright", files={"file": ("bright.png", bright)}).json()
    assert ok["checks"] == []
    wrong = client.post("/api/frames?role=bright", files={"file": ("sample.png", sample)}).json()
    assert any("препарат" in c for c in wrong["checks"])
    dark = client.post("/api/frames?role=dark", files={"file": ("bright.png", bright)}).json()
    assert any("светлый" in c for c in dark["checks"])
    saturated = image_io.encode_image(np.full((64, 64), 255, np.uint8), "png")[0]
    over = client.post("/api/frames?role=bright", files={"file": ("over.png", saturated)}).json()
    assert any("пересвечено" in c for c in over["checks"])


def test_tiff_metadata_is_preserved():
    buf = io.BytesIO()
    raw = np.full((40, 50), 20000, np.uint16)
    tifffile.imwrite(
        buf, raw, resolution=(3.2, 3.2), resolutionunit=3, datetime="2024:05:01 10:20:30",
        extratags=[(271, "s", 0, "Olympus", True), (272, "s", 0, "DP74", True)],
    )
    raw_info = upload(buf.getvalue(), "raw.tif")
    assert raw_info["metadata"]["Make"] == "Olympus"
    assert raw_info["metadata"]["pixel_size"] == "3125 мкм"
    bright_id = upload(image_io.encode_image(np.full((40, 50), 40000, np.uint16), "tiff")[0], "b.tif")["id"]
    out = client.post("/api/process/export", json={"raw_id": raw_info["id"], "bright_id": bright_id})
    with tifffile.TiffFile(io.BytesIO(out.content)) as tif:
        tags = tif.pages[0].tags
        assert tags["Make"].value == "Olympus" and tags["Model"].value == "DP74"
        assert tags["DateTime"].value == "2024:05:01 10:20:30"
        assert tags["XResolution"].value[0] / tags["XResolution"].value[1] == pytest.approx(3.2)
        assert int(tags["ResolutionUnit"].value) == 3
        log = json.loads(tags["ImageDescription"].value)
    assert log["source"]["metadata"]["Model"] == "DP74"
    assert json.loads(out.headers["x-correction-report"])["source_metadata"]["Make"] == "Olympus"


def test_batch_file_thumbnails(demo_ids):
    sample = client.get("/api/demo/sample-2.png").content
    response = client.post(
        "/api/process/file",
        files={"raw": ("s2.png", sample)},
        data={"bright_id": demo_ids["bright"], "thumbs": "true"},
    )
    thumbs = client.get(f"/api/thumbs/{response.headers['x-thumbs-id']}").json()
    assert thumbs["before"].startswith("data:image/jpeg") and thumbs["after"].startswith("data:image/jpeg")


def test_demo_from_own_files(tmp_path, monkeypatch):
    bright = image_io.encode_image(np.full((30, 40), 200, np.uint8), "png")[0]
    raw = image_io.encode_image(np.full((30, 40), 100, np.uint16), "tiff")[0]
    (tmp_path / "bright.png").write_bytes(bright)
    (tmp_path / "cells.tif").write_bytes(raw)
    (tmp_path / "notes.txt").write_text("не снимок")
    monkeypatch.setenv("DEMO_DIR", str(tmp_path))
    items = {i["name"]: i for i in client.get("/api/demo").json()}
    assert set(items) == {"bright", "sample-1"}
    assert items["sample-1"]["filename"] == "cells.tif" and items["sample-1"]["source"] == "files"
    response = client.get("/api/demo/sample-1")
    assert response.content == raw and response.headers["content-type"] == "image/tiff"


def test_demo_from_specimens_gets_synthetic_light(tmp_path, monkeypatch):
    specimen = np.full((300, 500, 3), 240, np.uint8)
    for y in range(20, 300, 40):  # мелкие «клетки» по всему полю, фон ровный
        for x in range(20, 500, 40):
            specimen[y : y + 8, x : x + 8] = (180, 60, 140)
    (tmp_path / "specimens").mkdir()
    (tmp_path / "specimens" / "tissue.jpg").write_bytes(image_io.encode_image(specimen, "jpeg")[0])
    monkeypatch.setenv("DEMO_DIR", str(tmp_path))
    items = {i["name"]: i for i in client.get("/api/demo").json()}
    assert set(items) == {"bright", "dark", "sample-1"} and items["sample-1"]["source"] == "specimens"
    ids = {n: upload(client.get(f"/api/demo/{n}").content, f"{n}.png")["id"] for n in items}
    body = client.post(
        "/api/process/preview",
        json={"raw_id": ids["sample-1"], "bright_id": ids["bright"], "dark_id": ids["dark"], "settings": {"color": {}}},
    ).json()
    # Искусственная засветка убирается почти полностью
    assert body["metrics"]["before"]["nonuniformity"] > 15
    assert body["metrics"]["after"]["nonuniformity"] < 3
