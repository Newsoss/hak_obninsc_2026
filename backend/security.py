"""
Защита публичного сервера: пароль (по желанию), лимит частоты запросов,
лимит размера запроса и ограничение одновременной тяжелой обработки.
"""
import base64
import secrets
import time
from collections import defaultdict

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

import config

# Запросы, которые загружают файлы и нагружают процессор
HEAVY_PATHS = {
    "/api/frames",
    "/api/frames/average",
    "/api/flat/series",
    "/api/process/export",
    "/api/process/file",
    "/api/process/batch",
    "/api/verify",
}


def _error(status: int, detail: str, retry_after: int = 0) -> JSONResponse:
    headers = {"Retry-After": str(retry_after)} if retry_after else {}
    return JSONResponse({"detail": detail}, status_code=status, headers=headers)


def _client(request: Request) -> str:
    # За nginx/Caddy uvicorn с --proxy-headers подставляет настоящий адрес из X-Forwarded-For
    return request.client.host if request.client else "unknown"


class BasicAuthMiddleware(BaseHTTPMiddleware):
    """Пароль на весь сайт и API, если задан ACCESS_PASSWORD. /api/health открыт для мониторинга."""

    async def dispatch(self, request: Request, call_next):
        if not config.ACCESS_PASSWORD or request.url.path == "/api/health" or request.method == "OPTIONS":
            return await call_next(request)
        header = request.headers.get("authorization", "")
        if header.lower().startswith("basic "):
            try:
                user, _, password = base64.b64decode(header[6:]).decode("utf-8").partition(":")
            except (ValueError, UnicodeDecodeError):
                user, password = "", ""
            if secrets.compare_digest(user, config.ACCESS_USER) and secrets.compare_digest(
                password, config.ACCESS_PASSWORD
            ):
                return await call_next(request)
        return Response(
            "Нужен логин и пароль",
            status_code=401,
            headers={"WWW-Authenticate": 'Basic realm="MicroCleaner", charset="UTF-8"'},
            media_type="text/plain; charset=utf-8",
        )


class LimitsMiddleware(BaseHTTPMiddleware):
    """
    Лимиты для /api: частота запросов с адреса (окно в минуту), размер запроса
    по Content-Length (отказ до чтения тела) и одновременная тяжелая обработка.
    Все проверки и счетчики — в одном потоке событий, без await между ними.
    """

    def __init__(self, app):
        super().__init__(app)
        self._windows: dict = {}
        self._active = defaultdict(int)
        self._total = 0

    def _rate_ok(self, client: str) -> int:
        """0 — можно; иначе — сколько секунд подождать."""
        now = time.monotonic()
        start, count = self._windows.get(client, (now, 0))
        if now - start >= 60:
            start, count = now, 0
        count += 1
        self._windows[client] = (start, count)
        if len(self._windows) > 10_000:  # не копим память на старых адресах
            self._windows = {k: v for k, v in self._windows.items() if now - v[0] < 60}
        return 0 if count <= config.RATE_LIMIT_PER_MIN else int(60 - (now - start)) + 1

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if not path.startswith("/api") or request.method == "OPTIONS":
            return await call_next(request)
        client = _client(request)

        wait = self._rate_ok(client)
        if wait:
            return _error(429, "Слишком много запросов — подождите немного", wait)

        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > config.MAX_REQUEST_MB * config.MB:
            return _error(413, f"Запрос больше {config.MAX_REQUEST_MB} МБ")

        if request.method != "POST" or path not in HEAVY_PATHS:
            return await call_next(request)
        if self._active[client] >= config.HEAVY_PER_CLIENT or self._total >= config.HEAVY_TOTAL:
            return _error(429, "Сервер занят обработкой — повторите через секунду", 1)
        self._active[client] += 1
        self._total += 1
        try:
            return await call_next(request)
        finally:
            self._active[client] -= 1
            self._total -= 1
            if not self._active[client]:
                del self._active[client]
