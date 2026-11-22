"""Сборка приложения FastAPI. Сервер запускает его командой `python -m app.cli serve`."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI

from app.api import admin, auth, boards, folders, health, sharing, sync, users
from app.auth.dependencies import same_origin
from app.auth.throttle import LoginThrottle
from app.core.config import Settings, get_settings
from app.core.db import Database
from app.sync.room import RoomManager, SavePolicy
from app.sync.sockets import BoardSockets


def create_app(settings: Settings | None = None) -> FastAPI:
    """Приложение с настройками settings, по умолчанию — из окружения.

    Всё, что держит ресурсы (пул соединений, комнаты досок), создаётся при запуске
    и освобождается при остановке, поэтому одно и то же приложение можно запускать повторно.
    """
    config = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        database = Database(config)
        rooms = RoomManager(
            database.sessions,
            SavePolicy(
                delay=config.sync_save_delay_seconds, compact_after=config.sync_compact_after
            ),
        )
        app.state.database = database
        app.state.rooms = rooms
        app.state.sockets = BoardSockets()
        app.state.login_throttle = LoginThrottle(
            max_failures=config.login_max_failures, window=config.login_window
        )
        try:
            yield
        finally:
            # Сначала комнаты дописывают принятые изменения, потом закрывается пул.
            await rooms.shutdown()
            await database.dispose()

    app = FastAPI(title="Whatever API", version="0.1.0", lifespan=lifespan)
    app.state.settings = config
    app.include_router(health.router, prefix="/api")
    # Изменяющие запросы принимаются только со страниц самого приложения.
    for router in (
        auth.router,
        boards.router,
        folders.router,
        sharing.router,
        users.router,
        admin.router,
    ):
        app.include_router(router, prefix="/api", dependencies=[Depends(same_origin)])
    app.include_router(sync.router)
    return app
