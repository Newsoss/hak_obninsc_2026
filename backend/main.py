from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.process import router as process_router

app = FastAPI(
    title="MicroCleaner API",
    description="Сервис высокоточной коррекции артефактов микроскопии (Flat-Field Correction)",
    version="1.0.0"
)

# Разрешаем CORS (чтобы React на порту 3000 и Ngrok работали без блокировок)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Подключаем роутер
app.include_router(process_router, prefix="/api")


@app.get("/health", tags=["System"])
def health_check():
    """Проверка доступности сервиса."""
    return {"status": "ok", "service": "MicroCleaner API v1.0"}