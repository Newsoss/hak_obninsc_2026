"""
Набор для кнопки «Открыть пример». Источник выбирается по содержимому папки
demo_data (путь можно задать переменной окружения DEMO_DIR):

1. Готовый набор — в папке лежат bright.* (светлое поле), по желанию dark.*,
   и любые другие снимки: они отдаются как есть, без изменений.
2. Свои снимки с искусственной засветкой — в demo_data/specimens лежат чистые
   равномерно освещенные микрофото: на них накладываются виньетирование, пыль
   и оттенок, а светлое поле и темновой кадр генерируются к ним точно.
3. Иначе — встроенный синтетический пример.
"""
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Callable, Dict, List

from adapters import image_io
from core import demo

DEFAULT_DIR = Path(__file__).resolve().parent.parent / "demo_data"

SOURCES = {
    "files": "готовый набор из demo_data",
    "specimens": "снимки из demo_data/specimens с искусственной засветкой",
    "synthetic": "встроенный синтетический пример",
}


@dataclass(frozen=True)
class DemoFile:
    name: str
    title: str
    filename: str
    source: str
    load: Callable[[], bytes]


def demo_dir() -> Path:
    return Path(os.getenv("DEMO_DIR", DEFAULT_DIR))


def _images(folder: Path) -> List[Path]:
    if not folder.is_dir():
        return []
    return sorted(
        (p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in image_io.SUPPORTED_EXTENSIONS),
        key=lambda p: p.name.lower(),
    )


def _png(image) -> bytes:
    return image_io.encode_image(image, "png")[0]


@lru_cache(maxsize=16)
def _specimen_png(path: str, mtime: float, seed: int) -> bytes:
    data = Path(path).read_bytes()
    return _png(demo.sample_from_image(image_io.read_image(data, Path(path).name), seed))


@lru_cache(maxsize=8)
def _synthetic_png(name: str) -> bytes:
    return _png(demo.generate(name))


def catalog() -> Dict[str, DemoFile]:
    folder = demo_dir()
    files = _images(folder)
    by_stem = {p.stem.lower(): p for p in files}

    if "bright" in by_stem:
        items = {"bright": DemoFile("bright", "Светлое поле", by_stem["bright"].name, "files", by_stem["bright"].read_bytes)}
        if "dark" in by_stem:
            items["dark"] = DemoFile("dark", "Темновой кадр", by_stem["dark"].name, "files", by_stem["dark"].read_bytes)
        samples = [p for p in files if p.stem.lower() not in ("bright", "dark")]
        for i, path in enumerate(samples, 1):
            items[f"sample-{i}"] = DemoFile(f"sample-{i}", path.stem, path.name, "files", path.read_bytes)
        return items

    specimens = _images(folder / "specimens")
    if specimens:
        items = {
            "bright": DemoFile("bright", "Светлое поле", "bright.png", "specimens", lambda: _synthetic_png("bright")),
            "dark": DemoFile("dark", "Темновой кадр", "dark.png", "specimens", lambda: _synthetic_png("dark")),
        }
        for i, path in enumerate(specimens, 1):
            loader = lambda p=path, s=i: _specimen_png(str(p), p.stat().st_mtime, s)  # noqa: E731
            items[f"sample-{i}"] = DemoFile(f"sample-{i}", path.stem, f"{path.stem}.png", "specimens", loader)
        return items

    return {
        name: DemoFile(name, title, f"demo-{name}.png", "synthetic", lambda n=name: _synthetic_png(n))
        for name, title in demo.catalog().items()
    }
