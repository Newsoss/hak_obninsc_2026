from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api import process

app = FastAPI(title="Microscope Image Correction API")

# Разрешаем запросы с React фронтенда
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"], # Порт Vite
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(process.router, prefix="/api/process")