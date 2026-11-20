# Whatever

Веб-приложение для создания диаграмм и совместной работы в реальном времени. Разворачивается на собственном сервере.

## Запуск на сервере

Нужны Linux и Docker с плагином Compose.

```bash
POSTGRES_PASSWORD=сложный-пароль docker compose up -d --build
```

Приложение откроется на порту 8080 (меняется переменной `WHATEVER_PORT`). Миграции базы применяются при старте бэкенда. Проверка: `curl http://localhost:8080/api/health`.

## Разработка

| Часть | Папка | Стек |
| --- | --- | --- |
| Фронтенд | `frontend/` | TypeScript, React, Vite, Canvas 2D |
| Бэкенд | `backend/` | Python 3.12, FastAPI, SQLAlchemy (async), Alembic |
| Данные | — | PostgreSQL 16, Redis 7 |

Бэкенд:

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload   # нужен PostgreSQL, адрес в WHATEVER_DATABASE_URL
uv run pytest
uv run ruff check . && uv run ruff format --check .
```

Фронтенд (запросы к `/api` и `/ws` проксируются на `localhost:8000`):

```bash
cd frontend
npm install
npm run dev
npm run test && npm run lint && npm run build
```

На холсте: колесо мыши двигает доску, Ctrl + колесо меняет масштаб, пробел + перетаскивание или средняя кнопка тоже двигают доску.
