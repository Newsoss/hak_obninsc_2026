"""
Сообщения сервера на русском и английском. Язык берется из заголовка
Accept-Language (интерфейс передает выбранный язык) и действует на весь запрос,
включая код в отдельных потоках.
"""
from contextvars import ContextVar

LANGUAGES = ("ru", "en")
_lang: ContextVar[str] = ContextVar("lang", default="ru")

MESSAGES = {
    # --- общие ошибки API ---
    "err.not_found": ("{label} не найден — загрузите файл заново", "{label} not found — upload the file again"),
    "label.raw": ("Исходный снимок", "Source image"),
    "label.bright": ("Светлое поле", "Bright field"),
    "label.dark": ("Темновой кадр", "Dark frame"),
    "err.settings": ("Некорректные настройки: {msg}", "Invalid settings: {msg}"),
    "err.file_too_big": ("{name}: файл больше {mb} МБ", "{name}: file is larger than {mb} MB"),
    "err.too_many_files": (
        "Слишком много файлов в одном запросе (больше {n})",
        "Too many files in one request (more than {n})",
    ),
    "err.format": ("Неизвестный формат {fmt}", "Unknown format {fmt}"),
    "err.thumbs": ("Миниатюры не найдены", "Thumbnails not found"),
    # --- чтение файлов ---
    "unit.um": ("мкм", "µm"),
    "io.dims": ("неподдерживаемая размерность изображения", "unsupported image dimensions"),
    "io.ext": ("{name}: формат {ext} не поддерживается", "{name}: format {ext} is not supported"),
    "io.empty": ("{name}: пустой файл", "{name}: empty file"),
    "io.corrupt": ("{name}: файл поврежден ({error})", "{name}: file is corrupted ({error})"),
    "io.decode": ("{name}: не удалось декодировать изображение", "{name}: could not decode the image"),
    "io.too_big": ("{name}: изображение слишком большое", "{name}: image is too large"),
    # --- проверка калибровки ---
    "cal.saturated": (
        "Светлое поле пересвечено: {share:.1f}% пикселей в насыщении. "
        "В этих местах неравномерность не исправится — уменьшите экспозицию калибровки.",
        "The bright field is overexposed: {share:.1f}% of pixels are saturated. "
        "Unevenness there cannot be corrected — reduce the calibration exposure.",
    ),
    "cal.too_dark": (
        "Светлое поле слишком тёмное — коррекция будет шумной. Увеличьте экспозицию калибровки.",
        "The bright field is too dark — the correction will be noisy. Increase the calibration exposure.",
    ),
    "cal.structure": (
        "В светлом поле видны мелкие детали ({share:.0f}% площади) — похоже на препарат "
        "или сильное загрязнение. Снимите калибровку на чистом участке стекла.",
        "The bright field contains fine details ({share:.0f}% of the area) — looks like a specimen "
        "or heavy dirt. Take the calibration on a clean area of the slide.",
    ),
    "cal.dark_too_bright": (
        "Темновой кадр слишком светлый — возможно, затвор был открыт или перепутаны файлы.",
        "The dark frame is too bright — maybe the shutter was open or the files were mixed up.",
    ),
    "cal.size": (
        "Размер {what} {cw}×{ch} не совпадает со снимком {rw}×{rh} — кадр масштабирован",
        "{what} size {cw}×{ch} does not match the image {rw}×{rh} — the frame was rescaled",
    ),
    "cal.channels": (
        "Число каналов {what} отличается от снимка — каналы приведены",
        "{what} has a different number of channels than the image — channels were converted",
    ),
    "cal.what.bright": ("светлого поля", "Bright field"),
    "cal.what.dark": ("темнового кадра", "Dark frame"),
    # --- оценка и усреднение калибровки ---
    "est.gaussian_note": (
        "Приблизительная коррекция: светлое поле не снималось, а оценено по самому снимку "
        "размытием (псевдо flat-field). Крупные объекты и плавные перепады окраски могут "
        "частично попасть в «фон». Для точной коррекции снимите светлое поле.",
        "Approximate correction: no bright field was taken, it was estimated from the image itself "
        "by blurring (pseudo flat-field). Large objects and smooth staining gradients may partly "
        "end up in the “background”. For an exact correction, take a bright field.",
    ),
    "est.series_note": (
        "Светлое поле не снималось, а оценено по {count} снимкам серии: в каждой точке кадра взят фон — "
        "значение, где нет препарата. Оценка верна, если препарат на снимках лежит в разных местах.",
        "No bright field was taken, it was estimated from {count} images of the series: at each point the "
        "background value (where there is no specimen) is used. Valid if the specimen is in different places.",
    ),
    "est.min_series": (
        "для оценки по серии нужно минимум {min} снимков, загружено {n}",
        "estimating from a series needs at least {min} images, got {n}",
    ),
    "est.size_mismatch": (
        "Снимки серии разного размера или формы кадра — приведены к первому.",
        "Images of the series differ in size or aspect — resized to the first one.",
    ),
    "est.few": (
        "Снимков всего {count} — оценка может быть шумной, лучше 10 и больше.",
        "Only {count} images — the estimate may be noisy, 10 or more is better.",
    ),
    "est.structure": (
        "В оценке светлого поля видны детали препарата: объекты на разных снимках слишком часто "
        "совпадают по положению. Добавьте снимки других полей зрения или снимите светлое поле.",
        "The estimated bright field shows specimen details: objects on different images overlap "
        "too often. Add images of other fields of view or take a bright field.",
    ),
    "est.frame_gaussian": ("оценка по снимку (размытие Гаусса)", "estimated from the image (Gaussian blur)"),
    "est.frame_series": (
        "оценка по серии ({count} снимков)",
        "estimated from the series ({count} images)",
    ),
    "avg.min": ("для усреднения нужно минимум 2 кадра", "averaging needs at least 2 frames"),
    "avg.max": (
        "для усреднения достаточно {max} кадров, загружено {n}",
        "{max} frames are enough for averaging, got {n}",
    ),
    "avg.shape": (
        "кадры разного размера: {a} и {b} — усредняются только кадры с одной камеры и одними настройками",
        "frames differ in size: {a} and {b} — only frames from the same camera and settings can be averaged",
    ),
    "avg.frame": ("среднее {count} кадров ({first}…)", "average of {count} frames ({first}…)"),
    "avg.note": (
        "Среднее {count} кадров {what}, крайние значения отброшены",
        "Average of {count} {what} frames, extreme values discarded",
    ),
    "avg.noise": ("; случайный шум ниже в {gain} раза", "; random noise is {gain}× lower"),
    "avg.what.bright": ("светлого поля", "bright field"),
    "avg.what.dark": ("темнового кадра", "dark"),
    # --- журнал обработки ---
    "log.note": (
        "Исследовательская обработка. Исходный файл не изменяется и хранится отдельно.",
        "Research image processing. The source file is not modified and is kept separately.",
    ),
    # --- проверка на эталоне ---
    "verify.none": ("Без коррекции", "No correction"),
    "verify.flat": ("Flat-field со светлым полем", "Flat-field with a bright field"),
    "verify.gaussian": ("Без светлого поля (оценка по снимку)", "No bright field (estimated from the image)"),
    "verify.builtin": ("встроенный препарат", "built-in specimen"),
    "verify.pass": (
        "Метод корректен: исправленный снимок отличается от эталона в среднем на {error}% диапазона",
        "The method is correct: the corrected image differs from the reference by {error}% of the range on average",
    ),
    "verify.fail": (
        "Отклонение от эталона {error}% — больше допустимых {limit}%",
        "Deviation from the reference is {error}% — more than the allowed {limit}%",
    ),
    # --- защита сервера ---
    "sec.auth": ("Нужен логин и пароль", "Login and password required"),
    "sec.rate": ("Слишком много запросов — подождите немного", "Too many requests — please wait a bit"),
    "sec.too_big": ("Запрос больше {mb} МБ", "Request is larger than {mb} MB"),
    "sec.busy": ("Сервер занят обработкой — повторите через секунду", "The server is busy — retry in a second"),
}


def language_from_header(header: str) -> str:
    """Первый поддерживаемый язык из Accept-Language, иначе русский."""
    for part in (header or "").split(","):
        code = part.split(";")[0].strip().lower()[:2]
        if code in LANGUAGES:
            return code
    return "ru"


def set_language(lang: str) -> None:
    _lang.set(lang if lang in LANGUAGES else "ru")


def get_language() -> str:
    return _lang.get()


def t(key: str, **params) -> str:
    text = MESSAGES[key][LANGUAGES.index(_lang.get())]
    return text.format(**params) if params else text


class LanguageMiddleware:
    """ASGI-middleware: язык запроса из Accept-Language — для всего, что выполняется дальше."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            headers = dict(scope.get("headers") or [])
            set_language(language_from_header(headers.get(b"accept-language", b"").decode("latin-1")))
        await self.app(scope, receive, send)
