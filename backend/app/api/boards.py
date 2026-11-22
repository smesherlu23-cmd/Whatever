"""Доски: список, создание, переименование, перенос в папку и удаление."""

import uuid
from datetime import UTC, datetime
from typing import Annotated, Self

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from app.access import Access, visible_boards
from app.api.folders import own_folder
from app.api.schemas import Person
from app.auth.dependencies import (
    CurrentUser,
    EditableBoard,
    ManagedBoard,
    OpenRooms,
    OpenSockets,
    ViewableBoard,
    admin_user,
)
from app.core.db import DbSession
from app.models import Board, User

router = APIRouter(prefix="/boards", tags=["boards"])


BoardName = Annotated[str, Field(min_length=1, max_length=200)]


class BoardOut(BaseModel):
    id: uuid.UUID
    name: str
    owner: Person | None
    # Папка в списке владельца. Остальным она не видна и не важна.
    folder_id: uuid.UUID | None
    access: Access
    created_at: datetime
    updated_at: datetime


def board_out(board: Board, user: User, access: Access) -> BoardOut:
    """Доска глазами пользователя user. Владелец доски должен быть загружен."""
    return BoardOut(
        id=board.id,
        name=board.name,
        owner=Person.model_validate(board.owner) if board.owner else None,
        folder_id=board.folder_id if board.owner_id == user.id else None,
        access=access,
        created_at=board.created_at,
        updated_at=board.updated_at,
    )


class BoardCreate(BaseModel):
    name: BoardName = "Новая доска"
    folder_id: uuid.UUID | None = None


class BoardUpdate(BaseModel):
    """Изменяются только переданные поля. folder_id: null переносит доску из папки в корень."""

    name: BoardName | None = None
    folder_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _has_changes(self) -> Self:
        if self.name is None and "folder_id" not in self.model_fields_set:
            raise ValueError("Нужно указать новое название или папку")
        return self


@router.get("")
async def list_boards(
    user: CurrentUser,
    db: DbSession,
    include_all: Annotated[bool, Query(alias="all")] = False,
) -> list[BoardOut]:
    """Свои доски и доски, к которым дали доступ. С ?all=true администратор видит все."""
    if not include_all:
        return [board_out(board, user, access) for board, access in await visible_boards(db, user)]
    admin = await admin_user(user)
    boards = await db.scalars(
        select(Board).options(joinedload(Board.owner)).order_by(Board.updated_at.desc())
    )
    return [board_out(board, admin, Access.MANAGE) for board in boards]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_board(body: BoardCreate, user: CurrentUser, db: DbSession) -> BoardOut:
    if body.folder_id is not None:
        await own_folder(db, user, body.folder_id)
    now = datetime.now(UTC)
    board = Board(
        name=body.name, owner=user, folder_id=body.folder_id, created_at=now, updated_at=now
    )
    db.add(board)
    await db.commit()
    return board_out(board, user, Access.MANAGE)


@router.get("/{board_id}")
async def get_board(target: ViewableBoard) -> BoardOut:
    return board_out(target.board, target.user, target.access)


@router.patch("/{board_id}")
async def update_board(target: EditableBoard, body: BoardUpdate, db: DbSession) -> BoardOut:
    board, user = target.board, target.user
    if "folder_id" in body.model_fields_set:
        # Папки личные, поэтому раскладывать доску по ним может только владелец.
        if board.owner_id != user.id:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "Переносить доску в папку может только её владелец"
            )
        if body.folder_id is not None:
            await own_folder(db, user, body.folder_id)
        board.folder_id = body.folder_id
    if body.name is not None:
        board.name = body.name
        board.updated_at = datetime.now(UTC)
    await db.commit()
    return board_out(board, user, target.access)


@router.delete("/{board_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_board(
    target: ManagedBoard, db: DbSession, rooms: OpenRooms, sockets: OpenSockets
) -> None:
    await db.delete(target.board)
    await db.commit()
    # Открытая комната больше ничего не запишет, а участники увидят, что доски нет.
    rooms.discard(target.board.id)
    await sockets.close_board(target.board.id)
