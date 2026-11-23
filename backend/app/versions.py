"""Версии досок: запись и срок хранения.

Версии сохраняет комната доски (app.sync.room): сама, пока доску меняют, и по просьбе
человека — с названием. Автоматические версии старше срока хранения удаляются, когда у доски
сохраняется новая: у доски, которую давно не меняли, история остаётся.
"""

import uuid
from collections.abc import Iterable
from datetime import timedelta

from sqlalchemy import delete, func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import BoardVersion, BoardVersionEditor


async def save_version(
    db: AsyncSession,
    board_id: uuid.UUID,
    state: bytes,
    *,
    editors: Iterable[uuid.UUID],
    retention: timedelta,
    name: str | None = None,
    saved_by: uuid.UUID | None = None,
) -> uuid.UUID:
    """Записывает версию доски с содержимым state и возвращает её id. Фиксирует транзакцию.

    editors — кто менял доску после предыдущей версии. Заодно удаляются автоматические версии
    этой доски, которые старше retention.
    """
    version = BoardVersion(board_id=board_id, name=name, state=state, saved_by_id=saved_by)
    db.add(version)
    await db.flush()
    version_id = version.id
    rows = [{"version_id": version_id, "user_id": user_id} for user_id in editors]
    if rows:
        await db.execute(insert(BoardVersionEditor).values(rows))
    await db.execute(
        delete(BoardVersion).where(
            BoardVersion.board_id == board_id,
            BoardVersion.name.is_(None),
            BoardVersion.created_at < func.now() - retention,
        )
    )
    await db.commit()
    return version_id
