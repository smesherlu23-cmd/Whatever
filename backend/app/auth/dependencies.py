"""Зависимости FastAPI для проверки входа и прав."""

from typing import Annotated
from urllib.parse import urlsplit

from fastapi import Depends, HTTPException, Request, status
from starlette.requests import HTTPConnection

from app.auth.sessions import COOKIE_NAME, user_for_token
from app.auth.throttle import LoginThrottle
from app.db import DbSession
from app.models import Role, User
from app.sync.sockets import SessionSockets

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


async def current_user(request: Request, db: DbSession) -> User:
    token = request.cookies.get(COOKIE_NAME)
    user = await user_for_token(db, token) if token else None
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Нужно войти в систему")
    return user


CurrentUser = Annotated[User, Depends(current_user)]


async def admin_user(user: CurrentUser) -> User:
    if user.role != Role.ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нужны права администратора")
    return user


AdminUser = Annotated[User, Depends(admin_user)]


def login_throttle(request: Request) -> LoginThrottle:
    throttle: LoginThrottle = request.app.state.login_throttle
    return throttle


Throttle = Annotated[LoginThrottle, Depends(login_throttle)]


def session_sockets(request: Request) -> SessionSockets:
    sockets: SessionSockets = request.app.state.sockets
    return sockets


OpenSockets = Annotated[SessionSockets, Depends(session_sockets)]
