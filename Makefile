# Частые команды разработки. Список с пояснениями: make help.
# Те же проверки запускает CI (.github/workflows/ci.yml).

.DEFAULT_GOAL := help
SHELL := bash
.SHELLFLAGS := -euo pipefail -c

COMPOSE_DEV := docker compose -f docker-compose.yml -f docker-compose.dev.yml

.PHONY: help install db migrate admin backend frontend format check check-backend check-frontend up down logs backup restore

help: ## показать список команд
	@awk 'BEGIN {FS = ":.*## "} /^[a-z-]+:.*## / {printf "  \033[1m%-16s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

.env:
	cp .env.example .env
	@echo "Создан .env: задайте в нём POSTGRES_PASSWORD"

install: .env ## установить зависимости бэкенда и фронтенда
	cd backend && uv sync --locked
	cd frontend && npm ci

db: .env ## запустить PostgreSQL для разработки на localhost
	$(COMPOSE_DEV) up -d --wait postgres

migrate: db ## применить миграции к базе разработки
	cd backend && uv run alembic upgrade head

admin: migrate ## создать администратора: make admin LOGIN=admin
	cd backend && uv run python -m app.cli create-admin $(or $(LOGIN),admin)

backend: migrate ## бэкенд с перезапуском при правке кода: http://localhost:8000
	cd backend && uv run python -m app.cli serve --reload

frontend: ## фронтенд с горячей перезагрузкой: http://localhost:5173
	cd frontend && npm run dev

format: ## отформатировать код и исправить то, что линтеры умеют сами
	cd backend && uv run ruff check --fix . && uv run ruff format .
	cd frontend && npm run format

check: check-backend check-frontend ## все проверки, как в CI

check-backend: db ## бэкенд: ruff, mypy, тесты с покрытием на PostgreSQL
	cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest --cov

check-frontend: ## фронтенд: Prettier, ESLint, TypeScript, тесты, сборка
	cd frontend && npm run check && npm run build

up: .env ## собрать и запустить приложение в Docker, как на сервере
	docker compose up -d --build --wait

down: ## остановить приложение в Docker (данные базы сохраняются)
	docker compose down

logs: ## журналы приложения в Docker
	docker compose logs -f --tail=100

backup: ## резервная копия базы и файлов сейчас, в папку backups/
	docker compose exec -T backup /ops/backup.sh once

restore: ## восстановить из копии: make restore BACKUP=whatever-<дата>
	ops/restore.sh $(or $(BACKUP),$(error Укажите копию: make restore BACKUP=whatever-<дата>))
