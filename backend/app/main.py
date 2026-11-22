from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI

from app.api import admin, auth, boards, folders, health, sharing, sync, users
from app.auth.dependencies import same_origin
from app.auth.throttle import LoginThrottle
from app.db import dispose_engine, session_factory
from app.sync.room import RoomManager
from app.sync.sockets import BoardSockets


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    rooms = RoomManager(session_factory)
    app.state.rooms = rooms
    app.state.login_throttle = LoginThrottle()
    app.state.sockets = BoardSockets()
    yield
    await rooms.shutdown()
    await dispose_engine()


def create_app() -> FastAPI:
    app = FastAPI(title="Whatever API", version="0.1.0", lifespan=lifespan)
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


app = create_app()
