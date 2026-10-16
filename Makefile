PY ?= backend/.venv/Scripts/python
ifeq ($(OS),)
PY = backend/.venv/bin/python
endif

.PHONY: install backend frontend test build docker

install:            ## Установить зависимости backend и frontend
	python -m venv backend/.venv
	$(PY) -m pip install -r backend/requirements-dev.txt
	cd frontend && npm install

backend:            ## API на :8000 с автоперезагрузкой
	cd backend && ../$(PY) -m uvicorn main:app --reload --port 8000

frontend:           ## Интерфейс на :3000 (проксирует /api на :8000)
	cd frontend && npm run dev

test:               ## Тесты backend
	cd backend && ../$(PY) -m pytest -q

build:              ## Собрать фронтенд — после этого всё работает с :8000
	cd frontend && npm run build

docker:             ## Всё в одном контейнере на :8000
	docker compose up --build
