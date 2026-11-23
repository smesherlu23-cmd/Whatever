"""Комментарии в обсуждениях: упоминания и уведомления о них.

Уведомление получают упомянутые через @логин и участники обсуждения (кто его начал и кто
в нём писал), когда в нём ответили. Упоминание важнее ответа: на один комментарий у человека
одно уведомление. Себя не уведомляют. Упомянуть и уведомить можно только того, кто может
открыть доску: остальным комментарий не виден.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import delete, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.access import people_with_access
from app.mentions import mentioned_logins
from app.models import (
    Board,
    Comment,
    CommentMention,
    CommentThread,
    Notification,
    NotificationKind,
    User,
)


async def add_comment(
    db: AsyncSession, board: Board, thread: CommentThread, author: User, text: str
) -> Comment:
    """Добавляет комментарий в обсуждение и уведомляет о нём. Не фиксирует транзакцию."""
    now = datetime.now(UTC)
    comment = Comment(thread_id=thread.id, author_id=author.id, text=text, created_at=now)
    db.add(comment)
    await db.flush()
    mentioned = await _save_mentions(db, board, comment)
    writers = select(Comment.author_id).where(Comment.thread_id == thread.id)
    participants = await people_with_access(
        db, board, or_(User.id == thread.author_id, User.id.in_(writers))
    )
    recipients = {person.id: NotificationKind.REPLY for person in participants}
    recipients.update(dict.fromkeys(mentioned, NotificationKind.MENTION))
    await _notify(db, comment, recipients, now)
    return comment


async def edit_comment(db: AsyncSession, board: Board, comment: Comment, text: str) -> None:
    """Меняет текст комментария. Новые упомянутые получают уведомление. Не фиксирует транзакцию."""
    now = datetime.now(UTC)
    before = set(
        await db.scalars(
            select(CommentMention.user_id).where(CommentMention.comment_id == comment.id)
        )
    )
    comment.text = text
    comment.edited_at = now
    await db.execute(delete(CommentMention).where(CommentMention.comment_id == comment.id))
    mentioned = await _save_mentions(db, board, comment)
    await _notify(db, comment, dict.fromkeys(mentioned - before, NotificationKind.MENTION), now)


async def _save_mentions(db: AsyncSession, board: Board, comment: Comment) -> set[uuid.UUID]:
    """Записывает, кого упомянули в комментарии, и возвращает их id."""
    logins = mentioned_logins(comment.text)
    if not logins:
        return set()
    people = await people_with_access(db, board, User.login.in_(logins))
    if people:
        await db.execute(
            insert(CommentMention).values(
                [{"comment_id": comment.id, "user_id": person.id} for person in people]
            )
        )
    return {person.id for person in people}


async def _notify(
    db: AsyncSession,
    comment: Comment,
    recipients: dict[uuid.UUID, NotificationKind],
    now: datetime,
) -> None:
    """Записывает уведомления о комментарии. Если уведомление о нём у человека уже есть
    (ответ, а потом в правке его упомянули), оно становится упоминанием и снова непрочитанным."""
    if comment.author_id is not None:
        recipients.pop(comment.author_id, None)
    if not recipients:
        return
    statement = insert(Notification).values(
        [
            {
                "id": uuid.uuid4(),
                "user_id": user_id,
                "comment_id": comment.id,
                "kind": kind,
                "created_at": now,
            }
            for user_id, kind in recipients.items()
        ]
    )
    await db.execute(
        statement.on_conflict_do_update(
            constraint="uq_notifications_user_comment",
            set_={
                "kind": statement.excluded.kind,
                "read_at": None,
                "created_at": statement.excluded.created_at,
            },
        )
    )
