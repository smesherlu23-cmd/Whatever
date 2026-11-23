"""Уведомления в колокольчике: упоминания и ответы в обсуждениях.

Браузер спрашивает их раз в минуту и когда вкладка снова на виду. Уведомления о досках,
к которым у пользователя больше нет доступа, не показываются и не считаются.
"""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, status
from pydantic import BaseModel
from sqlalchemy import Select, func, select, update
from sqlalchemy.orm import joinedload

from app.access import viewable_by
from app.api.schemas import Person
from app.auth.dependencies import CurrentUser
from app.core.db import DbSession
from app.models import Board, Comment, CommentThread, Notification, NotificationKind, User

router = APIRouter(prefix="/notifications", tags=["notifications"])

# Колокольчик показывает последние уведомления, старые остаются в базе.
LIMIT = 50
# Начало комментария, по которому понятно, о чём он. Целиком его читают на доске.
EXCERPT_LENGTH = 200


class BoardRef(BaseModel):
    id: uuid.UUID
    name: str


class NotificationOut(BaseModel):
    id: uuid.UUID
    kind: NotificationKind
    read: bool
    created_at: datetime
    # Кто написал комментарий.
    actor: Person | None
    board: BoardRef
    thread_id: uuid.UUID
    comment_id: uuid.UUID
    excerpt: str


class NotificationsOut(BaseModel):
    unread: int
    items: list[NotificationOut]


def _excerpt(text: str) -> str:
    return text if len(text) <= EXCERPT_LENGTH else f"{text[: EXCERPT_LENGTH - 1].rstrip()}…"


def _visible[*Row](query: Select[*Row], user: User) -> Select[*Row]:
    """Уведомления пользователя о досках, которые ему видны."""
    return (
        query.join(Comment, Comment.id == Notification.comment_id)
        .join(CommentThread, CommentThread.id == Comment.thread_id)
        .join(Board, Board.id == CommentThread.board_id)
        .where(Notification.user_id == user.id, viewable_by(user))
    )


@router.get("")
async def list_notifications(user: CurrentUser, db: DbSession) -> NotificationsOut:
    """Последние уведомления, начиная с новых, и сколько всего непрочитанных."""
    rows = await db.execute(
        _visible(select(Notification, Comment, Board), user)
        .options(joinedload(Comment.author))
        .order_by(Notification.created_at.desc())
        .limit(LIMIT)
    )
    unread = await db.scalar(
        _visible(select(func.count(Notification.id)), user).where(Notification.read_at.is_(None))
    )
    return NotificationsOut(
        unread=unread or 0,
        items=[
            NotificationOut(
                id=notification.id,
                kind=notification.kind,
                read=notification.read_at is not None,
                created_at=notification.created_at,
                actor=Person.model_validate(comment.author) if comment.author else None,
                board=BoardRef(id=board.id, name=board.name),
                thread_id=comment.thread_id,
                comment_id=comment.id,
                excerpt=_excerpt(comment.text),
            )
            for notification, comment, board in rows
        ],
    )


@router.post("/read-all", status_code=status.HTTP_204_NO_CONTENT)
async def read_all(user: CurrentUser, db: DbSession) -> None:
    await db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None))
        .values(read_at=datetime.now(UTC))
    )
    await db.commit()
