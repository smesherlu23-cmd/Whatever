from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends
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
        _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False)
    return _sessionmaker


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
