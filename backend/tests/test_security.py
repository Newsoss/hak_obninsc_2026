import base64

import numpy as np
import pytest
from fastapi.testclient import TestClient

import config
from adapters import image_io
from main import app


@pytest.fixture
def client():
    # Свежий экземпляр приложения: счетчики лимитов не переходят между тестами
    app.middleware_stack = app.build_middleware_stack()
    return TestClient(app)


def png(value=128, size=(32, 32)):
    return image_io.encode_image(np.full(size, value, np.uint8), "png")[0]


def test_password_protects_site_and_api(client, monkeypatch):
    monkeypatch.setattr(config, "ACCESS_PASSWORD", "secret")
    assert client.get("/api/demo").status_code == 401
    assert client.get("/api/health").status_code == 200  # мониторинг без пароля
    token = base64.b64encode(b"lab:secret").decode()
    assert client.get("/api/demo", headers={"Authorization": f"Basic {token}"}).status_code == 200
    wrong = base64.b64encode(b"lab:nope").decode()
    assert client.get("/api/demo", headers={"Authorization": f"Basic {wrong}"}).status_code == 401


def test_rate_limit(client, monkeypatch):
    monkeypatch.setattr(config, "RATE_LIMIT_PER_MIN", 5)
    codes = [client.get("/api/health").status_code for _ in range(7)]
    assert codes[:5] == [200] * 5 and codes[5] == 429


def test_request_and_file_size_limits(client, monkeypatch):
    monkeypatch.setattr(config, "MAX_REQUEST_MB", 1)
    big = b"x" * (2 * config.MB)
    response = client.post("/api/frames", files={"file": ("big.png", big)})
    assert response.status_code == 413
    monkeypatch.setattr(config, "MAX_REQUEST_MB", 2048)
    monkeypatch.setattr(config, "MAX_UPLOAD_MB", 1)
    response = client.post("/api/frames", files={"file": ("big.png", big)})
    assert response.status_code == 413 and "больше 1 МБ" in response.json()["detail"]


def test_too_many_files(client, monkeypatch):
    monkeypatch.setattr(config, "MAX_FILES_PER_REQUEST", 3)
    files = [("files", (f"{i}.png", png(100 + i))) for i in range(5)]
    assert client.post("/api/frames/average", files=files).status_code == 413


def test_heavy_concurrency_limit(client, monkeypatch):
    # Лимит 0: сервер «занят», тяжелая обработка сразу получает 429, легкие запросы — нет
    monkeypatch.setattr(config, "HEAVY_PER_CLIENT", 0)
    busy = client.post("/api/frames", files={"file": ("a.png", png())})
    assert busy.status_code == 429 and busy.headers["retry-after"] == "1"
    assert client.get("/api/demo").status_code == 200
