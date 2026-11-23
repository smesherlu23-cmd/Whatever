"""Индекс истории досок по (board_id, id)

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-23
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Загрузка доски читает её историю по порядку id: составной индекс избавляет от сортировки.
    op.create_index("ix_board_updates_board_id_id", "board_updates", ["board_id", "id"])
    op.drop_index("ix_board_updates_board_id", table_name="board_updates")


def downgrade() -> None:
    op.create_index("ix_board_updates_board_id", "board_updates", ["board_id"])
    op.drop_index("ix_board_updates_board_id_id", table_name="board_updates")
