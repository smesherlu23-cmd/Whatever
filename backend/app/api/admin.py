"""Админ-панель: управление учётными записями."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.schemas import Login, Password, PersonName, UserOut
from app.auth.dependencies import AdminUser, admin_user
from app.auth.passwords import hash_password
from app.auth.sessions import delete_user_sessions
from app.db import DbSession
from app.models import Role, User

router = APIRouter(prefix="/admin/users", tags=["admin"], dependencies=[Depends(admin_user)])


class UserCreate(BaseModel):
    login: Login
    name: PersonName
    password: Password
    role: Role = Role.USER


class UserUpdate(BaseModel):
    """Изменяются только переданные поля."""

    name: PersonName | None = None
    role: Role | None = None
    is_active: bool | None = None
    password: Password | None = None


async def _get(db: DbSession, user_id: uuid.UUID) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден")
    return user


@router.get("")
async def list_users(db: DbSession) -> list[UserOut]:
    users = await db.scalars(select(User).order_by(User.login))
    return [UserOut.model_validate(u) for u in users]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_user(body: UserCreate, db: DbSession) -> UserOut:
    user = User(
        login=body.login,
        name=body.name,
        role=body.role,
        password_hash=await hash_password(body.password),
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        raise HTTPException(status.HTTP_409_CONFLICT, "Такой логин уже занят") from None
    await db.refresh(user)
    return UserOut.model_validate(user)


@router.patch("/{user_id}")
async def update_user(
    user_id: uuid.UUID, body: UserUpdate, admin: AdminUser, db: DbSession
) -> UserOut:
    user = await _get(db, user_id)
    if user.id == admin.id and (body.is_active is False or body.role == Role.USER):
        # Иначе можно остаться без единого администратора.
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Нельзя заблокировать себя или снять с себя права"
        )
    if body.name is not None:
        user.name = body.name
    if body.role is not None:
        user.role = body.role
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.password is not None:
        user.password_hash = await hash_password(body.password)
    if body.is_active is False or body.password is not None:
        # Заблокированный или сменивший пароль пользователь выходит на всех устройствах.
        await delete_user_sessions(db, user.id)
    await db.commit()
    return UserOut.model_validate(user)
