import cv2
import numpy as np
from fastapi import UploadFile
import os
import uuid

TEMP_DIR = "temp_images"
os.makedirs(TEMP_DIR, exist_ok=True)

async def save_upload_to_cv2(file: UploadFile) -> np.ndarray:
    contents = await file.read()
    nparr = np.frombuffer(contents, np.uint8)
    return cv2.imdecode(nparr, cv2.IMREAD_UNCHANGED) # Сохраняем исходную битность

def save_result(image: np.ndarray) -> str:
    filename = f"{uuid.uuid4().hex}.png"
    filepath = os.path.join(TEMP_DIR, filename)
    cv2.imwrite(filepath, image)
    return filename