import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from api.routes import router

app = FastAPI(
    title="MicroCleaner API",
    description="Коррекция неравномерного освещения микроснимков методом flat-field correction",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "X-Correction-Report", "X-Thumbs-Id"],
)

app.include_router(router, prefix="/api")

# Собранный фронтенд (npm run build) раздается тем же сервером — один процесс на всё
STATIC_DIR = Path(os.getenv("STATIC_DIR", Path(__file__).parent.parent / "frontend" / "dist"))
if STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="frontend")
