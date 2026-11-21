"""Кто и что может делать с доской.

Доступ к доске складывается так: владелец и администраторы управляют ею, участники
получают просмотр или редактирование от владельца или по ссылке, остальные доску не видят.
"""

import uuid
from enum import StrEnum

from sqlalchemy import or_, select
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.models import Board, BoardMember, BoardRole, Role, User


class Access(StrEnum):
    """Уровень доступа к доске. Каждый следующий включает предыдущие."""

    VIEW = "view"
    """Смотреть доску и курсоры участников."""
    EDIT = "edit"
    """Менять содержимое и название."""
    MANAGE = "manage"
    """Выдавать и отзывать доступ, удалять доску."""

    def allows(self, needed: "Access") -> bool:
        return _RANK[self] >= _RANK[needed]


_RANK = {Access.VIEW: 0, Access.EDIT: 1, Access.MANAGE: 2}

ROLE_ACCESS = {BoardRole.VIEWER: Access.VIEW, BoardRole.EDITOR: Access.EDIT}


def manages(board: Board, user: User) -> bool:
    """Управляет ли пользователь доской независимо от прав участника."""
    return user.role == Role.ADMIN or board.owner_id == user.id


def access_from(board: Board, user: User, role: BoardRole | None) -> Access | None:
    """Доступ пользователя к доске, если его право участника уже известно."""
    if manages(board, user):
        return Access.MANAGE
    return ROLE_ACCESS[role] if role is not None else None


async def member_role(
    db: AsyncSession, board_id: uuid.UUID, user_id: uuid.UUID
) -> BoardRole | None:
    return await db.scalar(
        select(BoardMember.role).where(
            BoardMember.board_id == board_id, BoardMember.user_id == user_id
        )
    )


async def access_to(db: AsyncSession, board: Board, user: User) -> Access | None:
    """Доступ пользователя к доске или None, если доски ему не видно."""
    role = None if manages(board, user) else await member_role(db, board.id, user.id)
    return access_from(board, user, role)


async def visible_boards(db: AsyncSession, user: User) -> list[tuple[Board, Access]]:
    """Доски, которые пользователь создал или к которым ему дали доступ, начиная с недавних."""
    memberships = await db.execute(
        select(BoardMember.board_id, BoardMember.role).where(BoardMember.user_id == user.id)
    )
    roles = dict(memberships.all())
    boards = await db.scalars(
        select(Board)
        .options(joinedload(Board.owner))
        .where(or_(Board.owner_id == user.id, Board.id.in_(list(roles))))
        .order_by(Board.updated_at.desc())
    )
    return [
        (board, access)
        for board in boards
        if (access := access_from(board, user, roles.get(board.id))) is not None
    ]


async def grant(
    db: AsyncSession,
    board_id: uuid.UUID,
    user_id: uuid.UUID,
    role: BoardRole,
    *,
    upgrade_only: bool = False,
) -> None:
    """Делает пользователя участником доски с правом role. Не фиксирует транзакцию.

    Запись идёт одним атомарным INSERT … ON CONFLICT, поэтому два одновременных запроса
    (например, ссылку открыли дважды) не столкнутся. С upgrade_only уже выданное более
    сильное право не понижается.
    """
    dialect = db.get_bind().dialect.name
    insert = sqlite.insert if dialect == "sqlite" else postgresql.insert
    weaker = [r for r in BoardRole if not ROLE_ACCESS[r].allows(ROLE_ACCESS[role])]
    await db.execute(
        insert(BoardMember)
        .values(board_id=board_id, user_id=user_id, role=role)
        .on_conflict_do_update(
            index_elements=[BoardMember.board_id, BoardMember.user_id],
            set_={"role": role},
            where=BoardMember.role.in_(weaker) if upgrade_only else None,
        )
    )
