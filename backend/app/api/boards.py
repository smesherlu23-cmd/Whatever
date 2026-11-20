import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Board

router = APIRouter(prefix="/boards", tags=["boards"])
Session = Annotated[AsyncSession, Depends(get_session)]


BoardName = Annotated[str, Field(min_length=1, max_length=200)]


class BoardOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    created_at: datetime
    updated_at: datetime


class BoardCreate(BaseModel):
    name: BoardName = "Новая доска"


class BoardRename(BaseModel):
    name: BoardName


async def _get(session: AsyncSession, board_id: uuid.UUID) -> Board:
    board = await session.get(Board, board_id)
    if board is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Доска не найдена")
    return board


@router.get("")
async def list_boards(session: Session) -> list[BoardOut]:
    result = await session.scalars(select(Board).order_by(Board.updated_at.desc()))
    return [BoardOut.model_validate(b) for b in result]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_board(body: BoardCreate, session: Session) -> BoardOut:
    now = datetime.now(UTC)
    board = Board(name=body.name, created_at=now, updated_at=now)
    session.add(board)
    await session.commit()
    return BoardOut.model_validate(board)


@router.get("/{board_id}")
async def get_board(board_id: uuid.UUID, session: Session) -> BoardOut:
    return BoardOut.model_validate(await _get(session, board_id))


@router.patch("/{board_id}")
async def rename_board(board_id: uuid.UUID, body: BoardRename, session: Session) -> BoardOut:
    board = await _get(session, board_id)
    board.name = body.name
    board.updated_at = datetime.now(UTC)
    await session.commit()
    return BoardOut.model_validate(board)


@router.delete("/{board_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_board(board_id: uuid.UUID, session: Session) -> None:
    await session.delete(await _get(session, board_id))
    await session.commit()
