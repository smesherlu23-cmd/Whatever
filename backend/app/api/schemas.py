"""Схемы пользователей, общие для входа, админ-панели и доступа к доскам."""

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from app.auth.passwords import MAX_LENGTH, MIN_LENGTH
from app.models import Role


def normalize_login(value: str) -> str:
    return value.strip().lower()


Login = Annotated[
    str,
    Field(min_length=3, max_length=100, pattern=r"^\s*[A-Za-z0-9._@-]+\s*$"),
    AfterValidator(normalize_login),
]
Password = Annotated[str, Field(min_length=MIN_LENGTH, max_length=MAX_LENGTH)]
PersonName = Annotated[str, Field(min_length=1, max_length=200)]


class Person(BaseModel):
    """Пользователь глазами коллег: владелец доски, участник, кандидат в участники."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    login: str
    name: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    login: str
    name: str
    role: Role
    is_active: bool
    created_at: datetime
