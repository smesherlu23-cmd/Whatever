"""Сборка приложения FastAPI. Сервер запускает его командой `python -m app.cli serve`."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.api import (
    admin,
    auth,
    boards,
    comments,
    files,
    folders,
    health,
    metrics,
    notifications,
    sharing,
    sync,
    templates,
    users,
    versions,
)
from app.auth.dependencies import same_origin
from app.auth.throttle import LoginGuard, LoginThrottle
from app.core.config import Settings, get_settings
from app.core.db import Database
from app.core.metrics import Metrics, RequestContext
from app.files import FileStore
from app.sync.room import RoomManager, SavePolicy
from app.sync.sockets import BoardSockets


async def validation_failed(_request: Request, error: RequestValidationError) -> JSONResponse:
    """Ответ 422, как у FastAPI, но без присланных значений.

    Среди них бывают NaN и бесконечности: в JSON их нет, и ответ FastAPI с ними не собирается,
    так что вместо 422 клиент получил бы 500. А пароль из неудачного запроса незачем
    отправлять обратно.
    """
    errors = [{key: value for key, value in e.items() if key != "input"} for e in error.errors()]
    return JSONResponse(
        {"detail": jsonable_encoder(errors)}, status_code=status.HTTP_422_UNPROCESSABLE_CONTENT
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    """Приложение с настройками settings, по умолчанию — из окружения.

    Всё, что держит ресурсы (пул соединений, комнаты досок), создаётся при запуске
    и освобождается при остановке, поэтому одно и то же приложение можно запускать повторно.
    """
    config = settings or get_settings()
    # Показатели живут дольше одного запуска приложения: их обёртка подключается при сборке.
    collected = Metrics()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        database = Database(config)
        rooms = RoomManager(
            database.sessions,
            SavePolicy(
                delay=config.sync_save_delay_seconds,
                compact_after=config.sync_compact_after,
                version_interval=config.version_interval,
                version_retention=config.version_retention,
            ),
            metrics=collected,
        )
        collected.watch(rooms=rooms.open_rooms, connections=rooms.open_connections)
        app.state.database = database
        app.state.rooms = rooms
        app.state.sockets = BoardSockets()
        app.state.files = FileStore(config.files_dir, config.max_upload_bytes)
        app.state.login_throttle = LoginGuard(
            per_login=LoginThrottle(
                max_failures=config.login_max_failures, window=config.login_window
            ),
            per_address=LoginThrottle(
                max_failures=config.login_max_failures_per_address, window=config.login_window
            ),
        )
        try:
            yield
        finally:
            # Сначала комнаты дописывают принятые изменения, потом закрывается пул.
            await rooms.shutdown()
            await database.dispose()

    app = FastAPI(title="Whatever API", version="0.1.0", lifespan=lifespan)
    app.state.settings = config
    app.state.metrics = collected
    app.add_middleware(RequestContext, metrics=collected)
    app.exception_handler(RequestValidationError)(validation_failed)
    app.include_router(health.router, prefix="/api")
    app.include_router(metrics.router, prefix="/api")
    # Изменяющие запросы принимаются только со страниц самого приложения.
    for router in (
        auth.router,
        boards.router,
        comments.router,
        notifications.router,
        files.router,
        folders.router,
        sharing.router,
        templates.router,
        versions.router,
        users.router,
        admin.router,
    ):
        app.include_router(router, prefix="/api", dependencies=[Depends(same_origin)])
    app.include_router(sync.router)
    return app
