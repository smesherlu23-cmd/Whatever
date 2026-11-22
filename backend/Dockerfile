# syntax=docker/dockerfile:1
# Образ бэкенда: API, синхронизация досок и миграции (alembic upgrade head).

ARG PYTHON_VERSION=3.12

FROM ghcr.io/astral-sh/uv:0.11.32 AS uv

# ---------- Зависимости: собираются отдельно, uv и кэш в итоговый образ не попадают ----------
FROM python:${PYTHON_VERSION}-slim AS build
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv
WORKDIR /src
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    uv sync --locked --no-dev --no-install-project

# ---------- Рабочий образ ----------
FROM python:${PYTHON_VERSION}-slim AS runtime
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/opt/venv/bin:$PATH"
RUN groupadd --system --gid 10001 whatever \
    && useradd --system --uid 10001 --gid whatever --no-create-home --shell /usr/sbin/nologin whatever
WORKDIR /app
COPY --from=build /opt/venv /opt/venv
COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app
# Код принадлежит root и только читается: процесс не может изменить сам себя.
RUN python -m compileall -q app alembic
# Каталог файлов досок — единственное, куда процесс пишет. Пустой том compose при первом
# подключении получает его владельца и права.
RUN mkdir -p /var/lib/whatever/files && chown -R 10001:10001 /var/lib/whatever
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)"]
# Сервер внутри контейнера слушает все интерфейсы его сети; наружу его публикует только nginx.
CMD ["python", "-m", "app.cli", "serve", "--host", "0.0.0.0", "--port", "8000"]
