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
