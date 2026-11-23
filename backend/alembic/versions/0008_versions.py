"""История версий досок

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-23
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "board_versions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "board_id",
            sa.Uuid(),
            sa.ForeignKey("boards.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(200)),
        sa.Column("state", sa.LargeBinary(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("saved_by_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
    )
    op.create_index("ix_board_versions_board_created", "board_versions", ["board_id", "created_at"])
    op.create_index("ix_board_versions_saved_by_id", "board_versions", ["saved_by_id"])
    op.create_table(
        "board_version_editors",
        sa.Column(
            "version_id",
            sa.Uuid(),
            sa.ForeignKey("board_versions.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    op.create_index("ix_board_version_editors_user_id", "board_version_editors", ["user_id"])


def downgrade() -> None:
    op.drop_table("board_version_editors")
    op.drop_table("board_versions")
