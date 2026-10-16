"""Настройки сервера из переменных окружения. Значения по умолчанию подходят для одного VPS."""
import os

MB = 1024 * 1024


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


# Размеры загрузки
MAX_UPLOAD_MB = _int("MAX_UPLOAD_MB", 300)            # один файл
MAX_REQUEST_MB = _int("MAX_REQUEST_MB", 2048)         # весь запрос (например, пакет одним запросом)
MAX_FILES_PER_REQUEST = _int("MAX_FILES_PER_REQUEST", 200)

# Нагрузка с одного адреса
RATE_LIMIT_PER_MIN = _int("RATE_LIMIT_PER_MIN", 1200)  # любые запросы к /api
HEAVY_PER_CLIENT = _int("HEAVY_PER_CLIENT", 4)         # одновременная тяжелая обработка с одного адреса
HEAVY_TOTAL = _int("HEAVY_TOTAL", 8)                   # одновременная тяжелая обработка на весь сервер

# Память под загруженные кадры
FRAME_STORE_MB = _int("FRAME_STORE_MB", 1500)

# Пароль на сайт и API (HTTP Basic). Пусто — доступ открыт
ACCESS_USER = os.getenv("ACCESS_USER", "lab")
ACCESS_PASSWORD = os.getenv("ACCESS_PASSWORD", "")
