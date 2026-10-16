from fastapi import APIRouter, UploadFile, File, Form
from fastapi.responses import FileResponse
from core.image_math import apply_flat_field
from utils.file_handler import save_upload_to_cv2, save_result, TEMP_DIR
import os

router = APIRouter()

@router.post("/single")
async def process_single(
    raw_image: UploadFile = File(...),
    flat_image: UploadFile = File(...),
    dark_image: UploadFile = File(None)
):
    # 1. Читаем файлы в numpy массивы
    raw_arr = await save_upload_to_cv2(raw_image)
    flat_arr = await save_upload_to_cv2(flat_image)
    dark_arr = await save_upload_to_cv2(dark_image) if dark_image else None

    # 2. Вызываем чистую функцию математики
    corrected_arr = apply_flat_field(raw_arr, flat_arr, dark_arr)

    # 3. Сохраняем и отдаем
    filename = save_result(corrected_arr)
    file_path = os.path.join(TEMP_DIR, filename)
    
    return FileResponse(file_path, media_type="image/png")