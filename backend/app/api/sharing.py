"""Доступ к доске: участники с правом просмотра или редактирования и ссылки доступа."""

import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, or_, select
from sqlalchemy.orm import joinedload

from app.access import ROLE_ACCESS, Access, grant, manages, member_role
from app.api.boards import BoardOut, board_out
from app.api.schemas import Person
from app.auth.dependencies import CurrentUser, ManagedBoard, OpenSockets
from app.core.db import DbSession
from app.models import Board, BoardMember, BoardRole, ShareLink, User

router = APIRouter(tags=["sharing"])

LinkToken = Annotated[str, Path(min_length=1, max_length=64)]


class MemberOut(BaseModel):
    user: Person
    role: BoardRole


class LinkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    token: str
    role: BoardRole
    created_at: datetime
    expires_at: datetime | None


class AccessOut(BaseModel):
    owner: Person | None
    members: list[MemberOut]
    links: list[LinkOut]


class MemberIn(BaseModel):
    role: BoardRole


class LinkIn(BaseModel):
    role: BoardRole = BoardRole.VIEWER
    # Без срока ссылка действует, пока её не удалят.
    expires_in_days: Annotated[int, Field(ge=1, le=365)] | None = None


@router.get("/boards/{board_id}/access")
async def get_access(target: ManagedBoard, db: DbSession) -> AccessOut:
    board = target.board
    members = await db.scalars(
        select(BoardMember)
        .join(User, User.id == BoardMember.user_id)
        .options(joinedload(BoardMember.user))
        .where(BoardMember.board_id == board.id)
        .order_by(User.name)
    )
    now = datetime.now(UTC)
    links = await db.scalars(
        select(ShareLink)
        .where(
            ShareLink.board_id == board.id,
            or_(ShareLink.expires_at.is_(None), ShareLink.expires_at > now),
        )
        .order_by(ShareLink.created_at)
    )
    return AccessOut(
        owner=Person.model_validate(board.owner) if board.owner else None,
        members=[MemberOut(user=Person.model_validate(m.user), role=m.role) for m in members],
        links=[LinkOut.model_validate(link) for link in links],
    )


@router.put("/boards/{board_id}/members/{user_id}")
async def set_member(
    target: ManagedBoard,
    user_id: uuid.UUID,
    body: MemberIn,
    db: DbSession,
    sockets: OpenSockets,
) -> MemberOut:
    """Выдаёт пользователю доступ к доске или меняет уже выданный."""
    board = target.board
    if user_id == board.owner_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Владелец и так управляет доской")
    person = await db.get(User, user_id)
    if person is None or not person.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден")
    await grant(db, board.id, user_id, body.role)
    await db.commit()
    # Открытая у участника доска переподключится и получит новые права.
    await sockets.recheck_member(board.id, user_id)
    return MemberOut(user=Person.model_validate(person), role=body.role)


@router.delete("/boards/{board_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    target: ManagedBoard, user_id: uuid.UUID, db: DbSession, sockets: OpenSockets
) -> None:
    board_id = target.board.id
    await db.execute(
        delete(BoardMember).where(BoardMember.board_id == board_id, BoardMember.user_id == user_id)
    )
    await db.commit()
    await sockets.recheck_member(board_id, user_id)


@router.post("/boards/{board_id}/links", status_code=status.HTTP_201_CREATED)
async def create_link(target: ManagedBoard, body: LinkIn, db: DbSession) -> LinkOut:
    board_id = target.board.id
    now = datetime.now(UTC)
    # Заодно убираем истёкшие ссылки этой доски, чтобы таблица не росла бесконечно.
    await db.execute(
        delete(ShareLink).where(ShareLink.board_id == board_id, ShareLink.expires_at <= now)
    )
    link = ShareLink(
        token=secrets.token_urlsafe(24),
        board_id=board_id,
        role=body.role,
        created_at=now,
        expires_at=now + timedelta(days=body.expires_in_days) if body.expires_in_days else None,
    )
    db.add(link)
    await db.commit()
    return LinkOut.model_validate(link)


@router.delete("/boards/{board_id}/links/{token}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_link(target: ManagedBoard, token: LinkToken, db: DbSession) -> None:
    """Удалённая ссылка перестаёт работать. Доступ, уже полученный по ней, остаётся."""
    await db.execute(
        delete(ShareLink).where(ShareLink.board_id == target.board.id, ShareLink.token == token)
    )
    await db.commit()


@router.post("/links/{token}/join")
async def join_by_link(
    token: LinkToken, user: CurrentUser, db: DbSession, sockets: OpenSockets
) -> BoardOut:
    """Выдаёт вошедшему пользователю доступ по ссылке. Более сильное право не понижается."""
    link = await db.get(ShareLink, token)
    board = await db.get(Board, link.board_id, options=[joinedload(Board.owner)]) if link else None
    if link is None or board is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "Ссылка не действует: её удалили или в адресе ошибка"
        )
    if link.expires_at is not None and link.expires_at <= datetime.now(UTC):
        raise HTTPException(
            status.HTTP_410_GONE, "Срок действия ссылки истёк. Попросите владельца прислать новую."
        )
    if manages(board, user):
        return board_out(board, user, Access.MANAGE)
    before = await member_role(db, board.id, user.id)
    await grant(db, board.id, user.id, link.role, upgrade_only=True)
    await db.commit()
    # Запись только что сделана, так что право есть: по ссылке или более сильное, выданное раньше.
    after = await member_role(db, board.id, user.id) or link.role
    if after != before:
        await sockets.recheck_member(board.id, user.id)
    return board_out(board, user, ROLE_ACCESS[after])
