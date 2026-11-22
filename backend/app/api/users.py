"""Справочник коллег: из него выбирают, с кем поделиться доской."""

from fastapi import APIRouter, Depends
from sqlalchemy import select

from app.api.schemas import Person
from app.auth.dependencies import current_user
from app.db import DbSession
from app.models import User

router = APIRouter(prefix="/users", tags=["users"], dependencies=[Depends(current_user)])


@router.get("")
async def list_people(db: DbSession) -> list[Person]:
    """Активные пользователи по имени. Заблокированных выбрать нельзя: войти они не смогут."""
    users = await db.scalars(select(User).where(User.is_active).order_by(User.name))
    return [Person.model_validate(u) for u in users]
