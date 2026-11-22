"""Окружение Alembic. Адрес базы берётся из тех же настроек, что и у приложения."""

import asyncio
from logging.config import dictConfig

from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from alembic import context
from app import models  # noqa: F401  (регистрирует модели в метаданных)
from app.core.config import get_settings
from app.core.db import Base
from app.core.logging import logging_config

config = context.config
settings = get_settings()
# Тесты применяют миграции в своём процессе и настраивают журнал сами.
if config.attributes.get("configure_logging", True):
    dictConfig(logging_config(settings.log_level, settings.log_format))

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """alembic upgrade --sql: SQL-скрипт для ручного применения, без подключения к базе."""
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def _run(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    engine = create_async_engine(settings.database_url)
    try:
        async with engine.connect() as connection:
            await connection.run_sync(_run)
    finally:
        await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
