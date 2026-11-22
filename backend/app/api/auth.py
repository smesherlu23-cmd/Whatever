"""Вход, выход и смена своего пароля."""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import Password, UserOut, normalize_login
from app.auth.dependencies import AppSettings, CurrentUser, OpenSockets, Throttle
from app.auth.passwords import MAX_LENGTH, hash_password, needs_rehash, verify_password
from app.auth.sessions import (
    COOKIE_NAME,
    create_session,
    delete_session,
    delete_user_sessions,
)
from app.core.config import Settings
from app.core.db import DbSession
from app.models import User

router = APIRouter(prefix="/auth", tags=["auth"])

WRONG_CREDENTIALS = "Неверный логин или пароль"


class LoginIn(BaseModel):
    # Формат логина здесь не проверяется: любая ошибка входа выглядит одинаково.
    login: Annotated[str, Field(min_length=1, max_length=100)]
    password: Annotated[str, Field(min_length=1, max_length=MAX_LENGTH)]


class PasswordChange(BaseModel):
    current_password: Annotated[str, Field(min_length=1, max_length=MAX_LENGTH)]
    new_password: Password


async def _sign_in(db: AsyncSession, response: Response, user: User, settings: Settings) -> None:
    """Открывает новую сессию и отдаёт её токен в cookie, недоступной из JavaScript."""
    token = await create_session(db, user, settings.session_ttl)
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=int(settings.session_ttl.total_seconds()),
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )


@router.post("/login")
async def login(
    body: LoginIn,
    request: Request,
    response: Response,
    db: DbSession,
    throttle: Throttle,
    settings: AppSettings,
) -> UserOut:
    login_name = normalize_login(body.login)
    client = request.client.host if request.client else "unknown"
    key = f"{client}:{login_name}"
    if wait := throttle.retry_after(key):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Слишком много попыток входа. Попробуйте позже.",
            headers={"Retry-After": str(wait)},
        )

    user = await db.scalar(select(User).where(User.login == login_name))
    # Пароль проверяется и для несуществующего логина: время ответа не выдаёт, есть ли он.
    valid = await verify_password(user.password_hash if user else None, body.password)
    if user is None or not valid:
        throttle.failed(key)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, WRONG_CREDENTIALS)
    throttle.succeeded(key)
    if not user.is_active:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Учётная запись заблокирована. Обратитесь к администратору."
        )

    if needs_rehash(user.password_hash):
        user.password_hash = await hash_password(body.password)
    await _sign_in(db, response, user, settings)
    return UserOut.model_validate(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, response: Response, db: DbSession, sockets: OpenSockets) -> None:
    token = request.cookies.get(COOKIE_NAME)
    if token:
        await delete_session(db, token)
        # Открытые в других вкладках доски тоже отключаются.
        await sockets.close_session(token)
    response.delete_cookie(COOKIE_NAME, path="/")


@router.get("/me")
async def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    body: PasswordChange,
    user: CurrentUser,
    request: Request,
    response: Response,
    db: DbSession,
    sockets: OpenSockets,
    settings: AppSettings,
) -> None:
    """Меняет пароль и завершает все сессии, кроме новой: вход на других устройствах сбросится."""
    if not await verify_password(user.password_hash, body.current_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Текущий пароль указан неверно")
    user.password_hash = await hash_password(body.new_password)
    await delete_user_sessions(db, user.id)
    await _sign_in(db, response, user, settings)
    # Доски, открытые в этом браузере, остаются подключёнными, на других устройствах — нет.
    await sockets.close_user(user.id, keep_token=request.cookies.get(COOKIE_NAME))
