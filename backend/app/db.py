from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import Depends
from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings


class Base(DeclarativeBase):
    pass


# Пул соединений создаётся при первом обращении и закрывается при остановке приложения.
_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def session_factory() -> async_sessionmaker[AsyncSession]:
    """Фабрика сессий базы данных. Используется и в запросах, и в синхронизации по WebSocket."""
    global _engine, _sessionmaker
    if _sessionmaker is None:
        _engine = create_async_engine(get_settings().database_url, pool_pre_ping=True)
        if _engine.dialect.name == "sqlite":
            event.listen(_engine.sync_engine, "connect", _enforce_foreign_keys)
        _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False)
    return _sessionmaker


def _enforce_foreign_keys(connection: Any, _record: Any) -> None:
    """SQLite проверяет внешние ключи, только если попросить. С проверкой тесты на SQLite
    ведут себя как PostgreSQL: удаление доски каскадом убирает её участников и историю."""
    cursor = connection.cursor()
    cursor.execute("PRAGMA foreign_keys = ON")
    cursor.close()


async def get_session() -> AsyncIterator[AsyncSession]:
    """Зависимость FastAPI: сессия на время одного запроса."""
    async with session_factory()() as session:
        yield session


async def dispose_engine() -> None:
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sessionmaker = None


DbSession = Annotated[AsyncSession, Depends(get_session)]


def as_utc(moment: datetime) -> datetime:
    """Время из базы с часовым поясом. SQLite (тесты) отдаёт его без пояса, хотя пишется UTC."""
    return moment if moment.tzinfo is not None else moment.replace(tzinfo=UTC)
