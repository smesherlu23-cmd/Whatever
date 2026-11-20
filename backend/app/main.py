from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api import boards, health, sync
from app.db import dispose_engine, session_factory
from app.sync.room import RoomManager


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    rooms = RoomManager(session_factory)
    app.state.rooms = rooms
    yield
    await rooms.shutdown()
    await dispose_engine()


def create_app() -> FastAPI:
    app = FastAPI(title="Whatever API", version="0.1.0", lifespan=lifespan)
    app.include_router(health.router, prefix="/api")
    app.include_router(boards.router, prefix="/api")
    app.include_router(sync.router)
    return app


app = create_app()
