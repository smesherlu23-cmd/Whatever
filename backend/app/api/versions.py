"""История версий доски: список, названные версии и содержимое версии.

Историю видят и восстанавливают те, кто может править доску: восстановление — обычная правка,
которую браузер отправляет по синхронизации (src/versions). Удаляет версии тот, кто управляет
доской. Автоматические версии сохраняет комната доски (app.sync.room), а названные — она же
по запросу сюда: так в версию попадают и правки, ещё не записанные в базу.
"""

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, StringConstraints
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.access import Access
from app.api.schemas import Person
from app.auth.dependencies import CurrentUser, EditableBoard, OpenRooms, require_access
from app.core.db import DbSession
from app.models import Board, BoardVersion
from app.sync.room import VERSIONS_CHANGED

router = APIRouter(tags=["versions"])

VersionName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]

VERSION_NOT_FOUND = "Версия не найдена: возможно, её удалили"


class VersionOut(BaseModel):
    id: uuid.UUID
    # У автоматических версий названия нет.
    name: str | None
    created_at: datetime
    # Кто сохранил версию вручную.
    saved_by: Person | None
    # Кто менял доску после предыдущей версии.
    editors: list[Person]


class VersionIn(BaseModel):
    name: VersionName


def _version_out(version: BoardVersion) -> VersionOut:
    return VersionOut(
        id=version.id,
        name=version.name,
        created_at=version.created_at,
        saved_by=Person.model_validate(version.saved_by) if version.saved_by else None,
        editors=[Person.model_validate(user) for user in version.editors],
    )


# Кто сохранил версию и кто менял доску: всё, что показывает список.
WITH_PEOPLE = (joinedload(BoardVersion.saved_by), selectinload(BoardVersion.editors))


async def _load_version(db: AsyncSession, version_id: uuid.UUID) -> VersionOut:
    version = await db.scalar(
        select(BoardVersion)
        .options(*WITH_PEOPLE)
        .where(BoardVersion.id == version_id)
        # Объект из этой же сессии мог устареть после правки: читаем его заново.
        .execution_options(populate_existing=True)
    )
    if version is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, VERSION_NOT_FOUND)
    return _version_out(version)


@dataclass(frozen=True)
class VersionAccess:
    """Версия из пути запроса и её доска, если права на доску не ниже нужных."""

    version: BoardVersion
    board: Board


def version_access(needed: Access) -> Callable[..., Awaitable[VersionAccess]]:
    """Зависимость: версия version_id из пути, если права на её доску не ниже needed."""

    async def dependency(version_id: uuid.UUID, user: CurrentUser, db: DbSession) -> VersionAccess:
        version = await db.get(BoardVersion, version_id)
        board = await db.get(Board, version.board_id) if version else None
        if version is None or board is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, VERSION_NOT_FOUND)
        await require_access(db, board, user, needed)
        return VersionAccess(version, board)

    return dependency


EditableVersion = Annotated[VersionAccess, Depends(version_access(Access.EDIT))]
ManagedVersion = Annotated[VersionAccess, Depends(version_access(Access.MANAGE))]


@router.get("/boards/{board_id}/versions")
async def list_versions(target: EditableBoard, db: DbSession) -> list[VersionOut]:
    """Версии доски, начиная с новых."""
    versions = await db.scalars(
        select(BoardVersion)
        .options(*WITH_PEOPLE)
        .where(BoardVersion.board_id == target.board.id)
        .order_by(BoardVersion.created_at.desc())
    )
    return [_version_out(version) for version in versions]


@router.post("/boards/{board_id}/versions", status_code=status.HTTP_201_CREATED)
async def create_version(
    body: VersionIn, target: EditableBoard, db: DbSession, rooms: OpenRooms
) -> VersionOut:
    """Сохраняет версию с тем, что сейчас на доске, под названием из запроса."""
    version_id = await rooms.save_version(target.board.id, body.name, target.user.id)
    return await _load_version(db, version_id)


@router.patch("/versions/{version_id}")
async def rename_version(
    body: VersionIn, target: EditableVersion, db: DbSession, rooms: OpenRooms
) -> VersionOut:
    """Меняет название версии. Автоматическая версия с названием хранится без срока."""
    target.version.name = body.name
    await db.commit()
    await rooms.broadcast(target.board.id, VERSIONS_CHANGED)
    return await _load_version(db, target.version.id)


@router.delete("/versions/{version_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_version(target: ManagedVersion, db: DbSession, rooms: OpenRooms) -> None:
    await db.delete(target.version)
    await db.commit()
    await rooms.broadcast(target.board.id, VERSIONS_CHANGED)


@router.get("/versions/{version_id}/state")
async def get_version_state(target: EditableVersion, db: DbSession) -> Response:
    """Содержимое доски в этой версии одним обновлением Yjs."""
    state = await db.scalar(select(BoardVersion.state).where(BoardVersion.id == target.version.id))
    if state is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, VERSION_NOT_FOUND)
    # Содержимое версии не меняется, поэтому браузер может держать его у себя.
    return Response(
        state,
        media_type="application/octet-stream",
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )
