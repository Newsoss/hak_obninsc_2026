from typing import List, Optional
import numpy as np
from domain.base import BaseImageFilter


class ImageProcessingPipeline:
    """
    Оркестратор конвейера (паттерн Pipeline).
    Позволяет последовательно применять цепочку фильтров к лабораторному снимку.
    """

    def __init__(self, filters: Optional[List[BaseImageFilter]] = None):
        """
        :param filters: Начальный список фильтров. Если не передан, создается пустой пайплайн.
        """
        self._filters: List[BaseImageFilter] = filters if filters is not None else []

    def add_filter(self, image_filter: BaseImageFilter) -> "ImageProcessingPipeline":
        """
        Добавляет новый шаг обработки в конец конвейера.
        Возвращает self для поддержки цепочки вызовов (Fluent Interface / Method Chaining).
        """
        self._filters.append(image_filter)
        return self

    def execute(
        self,
        image: np.ndarray,
        bright_field: Optional[np.ndarray] = None,
        dark_field: Optional[np.ndarray] = None,
        **kwargs
    ) -> np.ndarray:
        """
        Последовательно прогоняет снимок через все зарегистрированные звенья пайплайна.

        :param image: Исходный снимок
        :param bright_field: Светлый кадр (передается фильтрам, которым он нужен)
        :param dark_field: Темный кадр (передается фильтрам, которым он нужен)
        :return: Итоговое обработанное изображение
        """
        current_image = image.copy()

        for stage in self._filters:
            current_image = stage.apply(
                image=current_image,
                bright_field=bright_field,
                dark_field=dark_field,
                **kwargs
            )

        return current_image