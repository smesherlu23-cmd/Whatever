"""Подключение к PostgreSQL."""

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import Settings

Sessions = async_sessionmaker[AsyncSession]


class Base(DeclarativeBase):
    pass


class Database:
    """Пул соединений и фабрика сессий.

    Пул привязан к циклу событий, в котором открыт, поэтому у каждого процесса (приложения,
    команды app.cli) свой объект Database, а закрывается он вместе с процессом.
    """

    def __init__(self, settings: Settings) -> None:
        self.engine = create_async_engine(
            settings.database_url,
            pool_size=settings.db_pool_size,
            max_overflow=settings.db_max_overflow,
            # Соединение, которое база закрыла (перезапуск, таймаут), заменяется незаметно.
            pool_pre_ping=True,
        )
        self.sessions: Sessions = async_sessionmaker(self.engine, expire_on_commit=False)

    async def dispose(self) -> None:
        await self.engine.dispose()


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    """Зависимость FastAPI: сессия на время одного запроса."""
    database: Database = request.app.state.database
    async with database.sessions() as session:
        yield session


DbSession = Annotated[AsyncSession, Depends(get_session)]
