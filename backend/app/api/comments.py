"""Обсуждения на досках: метки с комментариями, ответы, упоминания коллег и решённые вопросы.

Комментировать может любой, кто видит доску, в том числе зритель: так на ревью зовут людей
без права менять схему. Изменить комментарий может только его автор, а удалить — автор или
тот, кто управляет доской. Обсуждения хранятся в PostgreSQL, а не в документе доски: их нужно
находить, считать и рассылать по ним уведомления. Участники открытой доски узнают
об изменениях по её WebSocket (COMMENTS_CHANGED) и перечитывают обсуждения.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import ColumnElement, delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.access import Access, access_to, people_with_access
from app.api.schemas import Person
from app.auth.dependencies import NO_ACCESS, CurrentUser, OpenRooms, ViewableBoard
from app.comments import add_comment, edit_comment
from app.core.db import DbSession
from app.models import Board, Comment, CommentThread, Notification, User
from app.sync.room import COMMENTS_CHANGED

router = APIRouter(tags=["comments"])

CommentText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)
]
# id страницы и элемента из документа доски.
DocumentId = Annotated[str, Field(min_length=1, max_length=100)]
# Точка доски. Пределы отсекают бесконечность и заведомо битые значения.
Coordinate = Annotated[float, Field(ge=-1e9, le=1e9, allow_inf_nan=False)]
Fraction = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]


class ElementAnchor(BaseModel):
    """Метка на элементе: id элемента и место на нём в долях ширины и высоты."""

    id: DocumentId
    x: Fraction
    y: Fraction


class CommentOut(BaseModel):
    id: uuid.UUID
    author: Person | None
    text: str
    mentions: list[Person]
    created_at: datetime
    edited_at: datetime | None


class ThreadOut(BaseModel):
    id: uuid.UUID
    page: str
    # Где метку поставили. Метка элемента показывается на нём, пока элемент есть на доске.
    x: float
    y: float
    element: ElementAnchor | None
    author: Person | None
    created_at: datetime
    resolved_at: datetime | None
    resolved_by: Person | None
    comments: list[CommentOut]


class ThreadCreate(BaseModel):
    page: DocumentId
    x: Coordinate
    y: Coordinate
    element: ElementAnchor | None = None
    text: CommentText


class ThreadUpdate(BaseModel):
    resolved: bool


class CommentIn(BaseModel):
    text: CommentText


def _person(user: User | None) -> Person | None:
    return Person.model_validate(user) if user else None


def _anchor(thread: CommentThread) -> ElementAnchor | None:
    # Ограничение таблицы не даёт задать элемент без места на нём и наоборот.
    if thread.element_id is None or thread.element_x is None or thread.element_y is None:
        return None
    return ElementAnchor(id=thread.element_id, x=thread.element_x, y=thread.element_y)


def thread_out(thread: CommentThread) -> ThreadOut:
    """Обсуждение для ответа. Авторы, комментарии и упомянутые должны быть загружены."""
    return ThreadOut(
        id=thread.id,
        page=thread.page,
        x=thread.x,
        y=thread.y,
        element=_anchor(thread),
        author=_person(thread.author),
        created_at=thread.created_at,
        resolved_at=thread.resolved_at,
        resolved_by=_person(thread.resolved_by),
        comments=[
            CommentOut(
                id=comment.id,
                author=_person(comment.author),
                text=comment.text,
                mentions=[Person.model_validate(user) for user in comment.mentioned],
                created_at=comment.created_at,
                edited_at=comment.edited_at,
            )
            for comment in thread.comments
        ],
    )


async def _load_threads(db: AsyncSession, *where: ColumnElement[bool]) -> list[ThreadOut]:
    threads = await db.scalars(
        select(CommentThread)
        .options(
            joinedload(CommentThread.author),
            joinedload(CommentThread.resolved_by),
            selectinload(CommentThread.comments).options(
                joinedload(Comment.author), selectinload(Comment.mentioned)
            ),
        )
        .where(*where)
        .order_by(CommentThread.created_at)
        # Объекты из этой же сессии могли устареть после правки: читаем их заново.
        .execution_options(populate_existing=True)
    )
    return [thread_out(thread) for thread in threads]


async def _load_thread(db: AsyncSession, thread_id: uuid.UUID) -> ThreadOut:
    [thread] = await _load_threads(db, CommentThread.id == thread_id)
    return thread


@dataclass(frozen=True)
class ThreadAccess:
    """Обсуждение из пути запроса, его доска и права на неё того, кто спрашивает."""

    thread: CommentThread
    board: Board
    user: User
    access: Access

    def may_delete(self, author_id: uuid.UUID | None) -> bool:
        """Удалить своё может автор, а чужое — тот, кто управляет доской."""
        return author_id == self.user.id or self.access.allows(Access.MANAGE)


THREAD_NOT_FOUND = "Обсуждение не найдено: возможно, его удалили"


async def _thread_access(db: AsyncSession, user: User, thread_id: uuid.UUID) -> ThreadAccess:
    thread = await db.get(CommentThread, thread_id)
    board = await db.get(Board, thread.board_id) if thread else None
    if thread is None or board is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, THREAD_NOT_FOUND)
    access = await access_to(db, board, user)
    if access is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, NO_ACCESS)
    return ThreadAccess(thread, board, user, access)


async def thread_access(thread_id: uuid.UUID, user: CurrentUser, db: DbSession) -> ThreadAccess:
    """Зависимость: обсуждение thread_id, если доска с ним видна пользователю."""
    return await _thread_access(db, user, thread_id)


ThreadTarget = Annotated[ThreadAccess, Depends(thread_access)]


@dataclass(frozen=True)
class CommentAccess:
    comment: Comment
    target: ThreadAccess


async def comment_access(comment_id: uuid.UUID, user: CurrentUser, db: DbSession) -> CommentAccess:
    """Зависимость: комментарий comment_id, если доска с ним видна пользователю."""
    comment = await db.get(Comment, comment_id)
    if comment is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "Комментарий не найден: возможно, его удалили"
        )
    return CommentAccess(comment, await _thread_access(db, user, comment.thread_id))


CommentTarget = Annotated[CommentAccess, Depends(comment_access)]


async def _changed(db: AsyncSession, rooms: OpenRooms, board_id: uuid.UUID) -> None:
    """Фиксирует правку и сообщает о ней тем, у кого открыта доска."""
    await db.commit()
    await rooms.broadcast(board_id, COMMENTS_CHANGED)


@router.get("/boards/{board_id}/threads")
async def list_threads(target: ViewableBoard, db: DbSession) -> list[ThreadOut]:
    """Все обсуждения доски, в том числе решённые, по времени начала."""
    return await _load_threads(db, CommentThread.board_id == target.board.id)


@router.post("/boards/{board_id}/threads", status_code=status.HTTP_201_CREATED)
async def create_thread(
    target: ViewableBoard, body: ThreadCreate, db: DbSession, rooms: OpenRooms
) -> ThreadOut:
    """Начинает обсуждение: ставит метку и пишет первый комментарий."""
    board, user, anchor = target.board, target.user, body.element
    thread = CommentThread(
        board_id=board.id,
        page=body.page,
        x=body.x,
        y=body.y,
        element_id=anchor.id if anchor else None,
        element_x=anchor.x if anchor else None,
        element_y=anchor.y if anchor else None,
        author_id=user.id,
        created_at=datetime.now(UTC),
    )
    db.add(thread)
    await db.flush()
    await add_comment(db, board, thread, user, body.text)
    await _changed(db, rooms, board.id)
    return await _load_thread(db, thread.id)


@router.patch("/threads/{thread_id}")
async def update_thread(
    target: ThreadTarget, body: ThreadUpdate, db: DbSession, rooms: OpenRooms
) -> ThreadOut:
    """Отмечает вопрос решённым или открывает снова. Это может любой, кто видит доску."""
    thread = target.thread
    if body.resolved != (thread.resolved_at is not None):
        thread.resolved_at = datetime.now(UTC) if body.resolved else None
        thread.resolved_by_id = target.user.id if body.resolved else None
        await _changed(db, rooms, target.board.id)
    return await _load_thread(db, thread.id)


@router.delete("/threads/{thread_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_thread(target: ThreadTarget, db: DbSession, rooms: OpenRooms) -> None:
    """Удаляет обсуждение со всеми ответами."""
    if not target.may_delete(target.thread.author_id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Удалить обсуждение может его автор или тот, кто управляет доской",
        )
    await db.execute(delete(CommentThread).where(CommentThread.id == target.thread.id))
    await _changed(db, rooms, target.board.id)


@router.post("/threads/{thread_id}/comments", status_code=status.HTTP_201_CREATED)
async def reply(
    target: ThreadTarget, body: CommentIn, db: DbSession, rooms: OpenRooms
) -> ThreadOut:
    """Отвечает в обсуждении. Возвращает обсуждение целиком."""
    await add_comment(db, target.board, target.thread, target.user, body.text)
    await _changed(db, rooms, target.board.id)
    return await _load_thread(db, target.thread.id)


@router.patch("/comments/{comment_id}")
async def update_comment(
    target: CommentTarget, body: CommentIn, db: DbSession, rooms: OpenRooms
) -> ThreadOut:
    """Меняет текст своего комментария. Возвращает обсуждение целиком."""
    comment, thread = target.comment, target.target
    if comment.author_id != thread.user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Изменить комментарий может только автор")
    if body.text != comment.text:
        await edit_comment(db, thread.board, comment, body.text)
        await _changed(db, rooms, thread.board.id)
    return await _load_thread(db, comment.thread_id)


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(target: CommentTarget, db: DbSession, rooms: OpenRooms) -> None:
    """Удаляет ответ. Первый комментарий удаляется только вместе с обсуждением."""
    comment, thread = target.comment, target.target
    if not thread.may_delete(comment.author_id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Удалить комментарий может его автор или тот, кто управляет доской",
        )
    first = await db.scalar(
        select(Comment.id)
        .where(Comment.thread_id == comment.thread_id)
        .order_by(Comment.created_at)
        .limit(1)
    )
    if first == comment.id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Первый комментарий удаляется вместе с обсуждением"
        )
    await db.execute(delete(Comment).where(Comment.id == comment.id))
    await _changed(db, rooms, thread.board.id)


@router.post("/threads/{thread_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def read_thread(target: ThreadTarget, db: DbSession) -> None:
    """Отмечает прочитанными уведомления пользователя об этом обсуждении: его открыли."""
    await db.execute(
        update(Notification)
        .where(
            Notification.user_id == target.user.id,
            Notification.read_at.is_(None),
            Notification.comment_id.in_(
                select(Comment.id).where(Comment.thread_id == target.thread.id)
            ),
        )
        .values(read_at=datetime.now(UTC))
    )
    await db.commit()


@router.get("/boards/{board_id}/people")
async def list_board_people(target: ViewableBoard, db: DbSession) -> list[Person]:
    """Кого можно упомянуть в комментарии: активные пользователи, которые могут открыть доску."""
    return [Person.model_validate(user) for user in await people_with_access(db, target.board)]
