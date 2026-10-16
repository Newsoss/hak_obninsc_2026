"""
In-memory хранилище декодированных кадров.

Кадр загружается один раз, а дальше на него ссылаются по id: ползунки
цветокоррекции не гоняют файл по сети, а калибровку серии не надо
передавать заново с каждым снимком.
"""
import threading
import uuid
from collections import OrderedDict
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Frame:
    id: str
    name: str
    image: np.ndarray
    sha256: str = ""


class FrameStore:
    def __init__(self, max_bytes: int = 1_500_000_000, max_items: int = 200):
        self._frames: "OrderedDict[str, Frame]" = OrderedDict()
        self._bytes = 0
        self._max_bytes = max_bytes
        self._max_items = max_items
        self._lock = threading.Lock()

    def put(self, name: str, image: np.ndarray, sha256: str = "") -> Frame:
        frame = Frame(id=uuid.uuid4().hex, name=name, image=image, sha256=sha256)
        with self._lock:
            self._frames[frame.id] = frame
            self._bytes += image.nbytes
            while len(self._frames) > 1 and (
                self._bytes > self._max_bytes or len(self._frames) > self._max_items
            ):
                _, evicted = self._frames.popitem(last=False)
                self._bytes -= evicted.image.nbytes
        return frame

    def get(self, frame_id: str) -> Frame:
        with self._lock:
            frame = self._frames.get(frame_id)
            if frame is None:
                raise KeyError(frame_id)
            self._frames.move_to_end(frame_id)
            return frame
