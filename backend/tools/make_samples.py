"""
Генерирует тестовые снимки в папку samples/ в корне проекта.

Все кадры сняты «одной и той же оптикой»: виньетирование, перекос света,
пыль на оптике, тёплый оттенок лампы и шум матрицы. Поэтому их можно
обрабатывать как одну серию с общей калибровкой.

Запуск из папки backend:  python -m tools.make_samples
"""
from pathlib import Path

from adapters import image_io
from core import demo

OUT = Path(__file__).resolve().parents[2] / "samples"
SAMPLES = 6  # хватает и для пакета, и для оценки светлого поля по серии (от 5)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    files = {"bright.png": demo.generate("bright"), "dark.png": demo.generate("dark")}
    files.update({f"sample_{i:02d}.png": demo.generate(f"sample-{i}") for i in range(1, SAMPLES + 1)})
    for name, image in files.items():
        (OUT / name).write_bytes(image_io.encode_image(image, "png")[0])
        print(OUT / name)


if __name__ == "__main__":
    main()
