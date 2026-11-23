"""Зависимости FastAPI для проверки входа и прав."""

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload
from starlette.requests import HTTPConnection

from app.access import Access, access_to
from app.auth.sessions import COOKIE_NAME, user_for_token
from app.auth.throttle import LoginThrottle
from app.core.config import Settings
from app.core.db import DbSession
from app.files import FileStore
from app.models import Board, Role, User
from app.sync.room import RoomManager
from app.sync.sockets import BoardSockets

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def is_same_origin(connection: HTTPConnection) -> bool:
    """Пришёл ли запрос со страницы самого приложения.

    Дополняет SameSite=Lax у cookie: запрос, изменяющий данные, и подключение по WebSocket
    с чужого сайта (в том числе с соседнего поддомена) отклоняются.
    """
    origin = connection.headers.get("origin")
    if origin is None:
        # Браузер всегда шлёт Origin с WebSocket и с изменяющими запросами fetch.
        # Без него запрос пришёл не из браузера (curl, скрипт), и cookie жертвы у него нет.
        return True
    return urlsplit(origin).netloc == connection.headers.get("host")


async def same_origin(connection: HTTPConnection) -> None:
    method = connection.scope.get("method")
    if method in SAFE_METHODS:
        return
    if not is_same_origin(connection):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Запрос с чужого сайта отклонён")


def app_settings(connection: HTTPConnection) -> Settings:
    settings: Settings = connection.app.state.settings
    return settings


AppSettings = Annotated[Settings, Depends(app_settings)]


async def current_user(request: Request, db: DbSession, settings: AppSettings) -> User:
    token = request.cookies.get(COOKIE_NAME)
    user = await user_for_token(db, token, settings.session_ttl) if token else None
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Нужно войти в систему")
    return user


CurrentUser = Annotated[User, Depends(current_user)]


async def admin_user(user: CurrentUser) -> User:
    if user.role != Role.ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нужны права администратора")
    return user


AdminUser = Annotated[User, Depends(admin_user)]

NO_ACCESS = "Нет доступа к доске. Попросите владельца поделиться ею."


@dataclass(frozen=True)
class BoardAccess:
    """Доска из пути запроса и права на неё того, кто спрашивает."""

    board: Board
    user: User
    access: Access


async def require_access(db: AsyncSession, board: Board, user: User, needed: Access) -> Access:
    """Права пользователя на доску, если они не ниже needed. Иначе — ответ 403."""
    access = await access_to(db, board, user)
    if access is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, NO_ACCESS)
    if not access.allows(needed):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Недостаточно прав для этого действия")
    return access


def board_access(needed: Access) -> Callable[..., Awaitable[BoardAccess]]:
    """Зависимость: доска board_id из пути, если у пользователя есть доступ не ниже needed."""

    async def dependency(board_id: uuid.UUID, user: CurrentUser, db: DbSession) -> BoardAccess:
        board = await db.get(Board, board_id, options=[joinedload(Board.owner)])
        if board is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Доска не найдена")
        return BoardAccess(board, user, await require_access(db, board, user, needed))

    return dependency


ViewableBoard = Annotated[BoardAccess, Depends(board_access(Access.VIEW))]
EditableBoard = Annotated[BoardAccess, Depends(board_access(Access.EDIT))]
ManagedBoard = Annotated[BoardAccess, Depends(board_access(Access.MANAGE))]


def login_throttle(request: Request) -> LoginThrottle:
    throttle: LoginThrottle = request.app.state.login_throttle
    return throttle


Throttle = Annotated[LoginThrottle, Depends(login_throttle)]


def board_sockets(request: Request) -> BoardSockets:
    sockets: BoardSockets = request.app.state.sockets
    return sockets


OpenSockets = Annotated[BoardSockets, Depends(board_sockets)]


def open_rooms(request: Request) -> RoomManager:
    rooms: RoomManager = request.app.state.rooms
    return rooms


OpenRooms = Annotated[RoomManager, Depends(open_rooms)]


def file_store(request: Request) -> FileStore:
    store: FileStore = request.app.state.files
    return store


FileStorage = Annotated[FileStore, Depends(file_store)]
