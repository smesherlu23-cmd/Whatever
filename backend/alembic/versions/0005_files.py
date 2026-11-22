"""Картинки и вложения досок

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-22
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "board_files",
        sa.Column(
            "board_id",
            sa.Uuid(),
            sa.ForeignKey("boards.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("content_type", sa.String(100), nullable=False),
        sa.Column("size", sa.BigInteger(), nullable=False),
        sa.Column("uploaded_by_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_board_files_uploaded_by_id", "board_files", ["uploaded_by_id"])


def downgrade() -> None:
    op.drop_index("ix_board_files_uploaded_by_id", table_name="board_files")
    op.drop_table("board_files")
