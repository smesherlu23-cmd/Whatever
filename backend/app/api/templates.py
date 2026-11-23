"""Шаблоны компании: список и сохранение доски шаблоном.

Шаблон — копия доски с отметкой is_template. Его видят все: при создании доски с него
снимается копия. Править шаблон могут его владелец, администраторы и те, кому владелец
дал право редактирования, а удаляют и переименовывают его как обычную доску.
"""

from datetime import UTC, datetime

from fastapi import APIRouter, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from app.access import Access, access_from
from app.api.boards import BoardName, BoardOut, board_out
from app.auth.dependencies import CurrentUser, FileStorage, ManagedBoard, OpenRooms
from app.board_content import save_copy
from app.core.db import DbSession
from app.models import Board, BoardMember

router = APIRouter(tags=["templates"])


class TemplateCreate(BaseModel):
    name: BoardName


@router.get("/templates")
async def list_templates(user: CurrentUser, db: DbSession) -> list[BoardOut]:
    """Все шаблоны компании по названию."""
    templates = (
        await db.scalars(
            select(Board)
            .options(joinedload(Board.owner))
            .where(Board.is_template)
            .order_by(Board.name)
        )
    ).all()
    memberships = await db.execute(
        select(BoardMember.board_id, BoardMember.role).where(
            BoardMember.user_id == user.id,
            BoardMember.board_id.in_([template.id for template in templates]),
        )
    )
    roles = dict(memberships.all())
    # Шаблон виден всем, поэтому access_from не вернёт None; VIEW здесь только для типов.
    return [
        board_out(
            template, user, access_from(template, user, roles.get(template.id)) or Access.VIEW
        )
        for template in templates
    ]


@router.post("/boards/{board_id}/template", status_code=status.HTTP_201_CREATED)
async def save_as_template(
    target: ManagedBoard,
    body: TemplateCreate,
    db: DbSession,
    rooms: OpenRooms,
    files: FileStorage,
) -> BoardOut:
    """Сохраняет копию доски шаблоном компании. Шаблон увидят все, поэтому сохранить его
    может только тот, кто управляет доской, как и делиться ею."""
    # Копия берёт и правки последних долей секунды, которые комната ещё не записала.
    await rooms.flush(target.board.id)
    now = datetime.now(UTC)
    template = Board(
        name=body.name, owner=target.user, is_template=True, created_at=now, updated_at=now
    )
    await save_copy(db, files, template, target.board.id)
    return board_out(template, target.user, Access.MANAGE)
