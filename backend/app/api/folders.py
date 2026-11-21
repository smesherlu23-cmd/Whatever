"""Личные папки для досок. Папки вкладываются друг в друга; чужих папок не видно."""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser
from app.db import DbSession
from app.models import Board, Folder, User

router = APIRouter(prefix="/folders", tags=["folders"])

FolderName = Annotated[str, Field(min_length=1, max_length=200)]


class FolderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    parent_id: uuid.UUID | None
    created_at: datetime


class FolderCreate(BaseModel):
    name: FolderName
    parent_id: uuid.UUID | None = None


class FolderRename(BaseModel):
    name: FolderName


async def own_folder(db: AsyncSession, user: User, folder_id: uuid.UUID) -> Folder:
    """Папка пользователя. Чужая папка неотличима от несуществующей."""
    folder = await db.get(Folder, folder_id)
    if folder is None or folder.owner_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Папка не найдена")
    return folder


@router.get("")
async def list_folders(user: CurrentUser, db: DbSession) -> list[FolderOut]:
    """Все папки пользователя одним списком: дерево по parent_id строит клиент."""
    folders = await db.scalars(
        select(Folder).where(Folder.owner_id == user.id).order_by(Folder.name)
    )
    return [FolderOut.model_validate(f) for f in folders]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_folder(body: FolderCreate, user: CurrentUser, db: DbSession) -> FolderOut:
    if body.parent_id is not None:
        await own_folder(db, user, body.parent_id)
    # Папки не переносятся между родителями, поэтому циклов в дереве быть не может.
    folder = Folder(
        name=body.name, owner_id=user.id, parent_id=body.parent_id, created_at=datetime.now(UTC)
    )
    db.add(folder)
    await db.commit()
    return FolderOut.model_validate(folder)


@router.patch("/{folder_id}")
async def rename_folder(
    folder_id: uuid.UUID, body: FolderRename, user: CurrentUser, db: DbSession
) -> FolderOut:
    folder = await own_folder(db, user, folder_id)
    folder.name = body.name
    await db.commit()
    return FolderOut.model_validate(folder)


@router.delete("/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_folder(folder_id: uuid.UUID, user: CurrentUser, db: DbSession) -> None:
    """Удаляет папку, а её доски и вложенные папки поднимает на уровень выше."""
    folder = await own_folder(db, user, folder_id)
    await db.execute(
        update(Folder).where(Folder.parent_id == folder.id).values(parent_id=folder.parent_id)
    )
    await db.execute(
        update(Board).where(Board.folder_id == folder.id).values(folder_id=folder.parent_id)
    )
    await db.delete(folder)
    await db.commit()
