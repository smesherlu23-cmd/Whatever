# Разработка

## Окружение

Нужны Docker, [uv](https://docs.astral.sh/uv/) и Node.js 22 (версия — в `frontend/.nvmrc`).
Python 3.12 uv установит сам по `backend/.python-version`.

```bash
make install                  # зависимости и .env из .env.example
# задайте в .env POSTGRES_PASSWORD — любой, это база для разработки
make db                       # PostgreSQL в Docker, опубликован на localhost:5432
make admin LOGIN=admin        # миграции и первый администратор
make backend                  # http://localhost:8000, перезапуск при правке кода
make frontend                 # http://localhost:5173, запросы к /api и /ws идут на бэкенд
uvx pre-commit install        # ruff и Prettier перед каждым коммитом (один раз)
```

`make help` показывает все команды. `make up` собирает и запускает приложение в Docker
так же, как на сервере: на http://localhost:8080.

## Проверки

```bash
make check                    # всё, что запускает CI
make format                   # исправить форматирование и то, что линтеры чинят сами
```

| Часть | Что проверяется |
| --- | --- |
| Бэкенд | ruff (линтер, включая bandit, и форматирование), `mypy --strict`, pytest с покрытием не ниже 90%, предупреждения считаются ошибками |
| Миграции | применение, откат и повторное применение на PostgreSQL; модели совпадают с миграциями |
| Фронтенд | Prettier, ESLint (`strictTypeChecked`), TypeScript `strict` и `noUncheckedIndexedAccess`, Vitest с порогами покрытия, сборка |
| Docker | hadolint, сборка образов, запуск всего стека и проверка `/api/health`, контейнеры не от root |

Тесты бэкенда работают с настоящим PostgreSQL из `.env` (`make db`), в отдельной базе
`<POSTGRES_DB>_test`. Её пересоздают при каждом запуске, данные разработки она не трогает.

Pull request принимается, когда CI зелёный. Ослаблять проверки (пороги покрытия, правила
линтеров, `type: ignore`, `eslint-disable`) ради прохождения CI нельзя: исправляется код.

## Правила кода

**Конфигурация.** Всё, что зависит от окружения, — поле класса `Settings`
в `backend/app/core/config.py` и строка в `.env.example` (тест `test_config` следит,
чтобы они совпадали). Настройки читаются только в точках входа (`create_app`, `app.cli`,
миграции) и дальше передаются явно: через `app.state`, зависимости FastAPI и параметры
конструкторов. На фронтенде то же место — `frontend/src/config.ts`. Константы алгоритмов
(допуски распознавания, размеры) живут рядом со своим кодом.

**Типы.** Без `Any` там, где тип известен; без `!` и непроверенных `as` в TypeScript.
Данные, пришедшие по сети от других участников, проверяются при чтении (`model/validate.ts`).

**База данных.** Схема меняется только новой миграцией (`uv run alembic revision
--autogenerate -m "…"`), уже выпущенные миграции не правятся. Связи моделей загружаются
явно (`lazy="raise"`): неявный запрос в асинхронном коде — ошибка.

**Асинхронность.** В обработчиках запросов и синхронизации нет блокирующих вызовов:
тяжёлое (хеширование паролей) уходит в `asyncio.to_thread`.

**Тесты.** Новое поведение — новый тест на уровне, где его видно пользователю: API через
`TestClient`, синхронизация — клиентами pycrdt, интерфейс — Testing Library.

**Язык.** Интерфейс, сообщения об ошибках, комментарии и документация — на русском;
имена в коде — на английском.

## Структура

```
backend/
  app/core/        настройки, подключение к базе, журнал
  app/api/         обработчики HTTP и WebSocket
  app/auth/        пароли, сессии, защита от подбора, зависимости проверки прав
  app/sync/        комнаты досок и реестр подключений
  app/access.py    правила доступа к доскам
  app/models.py    таблицы
  app/cli.py       serve, create-admin
  alembic/         миграции
frontend/src/
  config.ts        адреса сервера и ключи хранилища браузера
  model/ recognition/ editor/ canvas/ collab/ auth/ pages/ ui/
docs/              руководство пользователя и эксплуатация
```

Подробно о слоях и решениях — в [ARCHITECTURE.md](ARCHITECTURE.md).

## Релиз

1. Новая запись в начале [CHANGELOG.md](CHANGELOG.md) и та же версия в
   `backend/app/__init__.py`, `backend/pyproject.toml` и `frontend/package.json`
   (`tests/test_version.py` проверяет, что они совпадают).
2. После слияния в main: `git tag v<версия> && git push origin v<версия>`.
3. Workflow Release соберёт образы, опубликует их в GitHub Container Registry и создаст
   страницу релиза с записью из CHANGELOG.md и архивом образов.
