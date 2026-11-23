"""Содержимое досок целиком: состояние документа Yjs и копии досок.

Состояние доски — все её дельты из board_updates, слитые в одно обновление Yjs. Копия
доски (шаблон или доска из шаблона) получает это состояние одной строкой, а файлы
источника — под теми же id, поэтому ссылки на картинки в содержимом остаются верными.

Слияние и проверка обновлений идут в потоке: на большой доске это заметная работа
процессора, и цикл событий не должен её ждать.
"""

import asyncio
import uuid
from typing import Any

from pycrdt import Doc
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.files import FileStore
from app.models import Board, BoardFile, BoardUpdate

# Содержимое, которое присылает браузер (встроенные шаблоны), весит несколько килобайт.
MAX_CONTENT_BYTES = 512 * 1024


class InvalidContentError(ValueError):
    """Присланные данные — не обновление Yjs."""


def _merge(updates: list[bytes]) -> bytes:
    doc: Doc[Any] = Doc()
    for update in updates:
        doc.apply_update(update)
    return doc.get_update()


async def read_state(db: AsyncSession, board_id: uuid.UUID) -> bytes:
    """Состояние доски одним обновлением Yjs. У пустой доски это пустое обновление."""
    rows = await db.scalars(
        select(BoardUpdate.data).where(BoardUpdate.board_id == board_id).order_by(BoardUpdate.id)
    )
    return await asyncio.to_thread(_merge, list(rows))


async def check_content(data: bytes) -> None:
    """Проверяет, что data — обновление Yjs, которое применяется к пустому документу."""
    try:
        await asyncio.to_thread(_merge, [data])
    except ValueError as error:
        raise InvalidContentError(str(error)) from error


async def save_board(db: AsyncSession, board: Board, content: bytes | None = None) -> None:
    """Сохраняет новую доску с содержимым content. Фиксирует транзакцию."""
    db.add(board)
    if content is not None:
        # Строка содержимого ссылается на доску, поэтому доска записывается первой.
        await db.flush()
        db.add(BoardUpdate(board_id=board.id, data=content))
    await db.commit()


async def save_copy(db: AsyncSession, files: FileStore, board: Board, source_id: uuid.UUID) -> None:
    """Сохраняет новую доску board копией доски source_id: её содержимое и файлы.

    Фиксирует транзакцию. Если записать копию не удалось, её файлы удаляются, а база
    откатывается вместе с сессией.
    """
    state = await read_state(db, source_id)
    sources = (await db.scalars(select(BoardFile).where(BoardFile.board_id == source_id))).all()
    db.add(board)
    await db.flush()
    db.add(BoardUpdate(board_id=board.id, data=state))
    db.add_all(
        BoardFile(
            board_id=board.id,
            id=source.id,
            name=source.name,
            content_type=source.content_type,
            size=source.size,
            uploaded_by_id=source.uploaded_by_id,
            created_at=source.created_at,
        )
        for source in sources
    )
    try:
        await files.copy_board(source_id, board.id, [source.id for source in sources])
        await db.commit()
    except BaseException:
        # Без ожидания: при отмене запроса любое await прервётся снова.
        files.discard_board(board.id)
        raise
