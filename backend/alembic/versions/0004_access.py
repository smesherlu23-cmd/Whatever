"""Права доступа: владелец доски, папки, участники и ссылки

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-21
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _created_at() -> sa.Column[sa.DateTime]:
    return sa.Column(
        "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


def upgrade() -> None:
    op.create_table(
        "folders",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "owner_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("parent_id", sa.Uuid(), sa.ForeignKey("folders.id", ondelete="CASCADE")),
        sa.Column("name", sa.String(200), nullable=False),
        _created_at(),
    )
    op.create_index("ix_folders_owner_id", "folders", ["owner_id"])
    op.create_index("ix_folders_parent_id", "folders", ["parent_id"])

    # batch_alter_table нужен SQLite (тесты): там внешний ключ добавляется пересозданием таблицы.
    with op.batch_alter_table("boards") as batch:
        batch.add_column(
            sa.Column(
                "owner_id",
                sa.Uuid(),
                sa.ForeignKey("users.id", name="fk_boards_owner_id", ondelete="SET NULL"),
            )
        )
        batch.add_column(
            sa.Column(
                "folder_id",
                sa.Uuid(),
                sa.ForeignKey("folders.id", name="fk_boards_folder_id", ondelete="SET NULL"),
            )
        )
    op.create_index("ix_boards_owner_id", "boards", ["owner_id"])
    op.create_index("ix_boards_folder_id", "boards", ["folder_id"])
    # До этой версии все доски были общими. Они переходят к первому администратору,
    # а он уже решает, с кем ими поделиться.
    op.execute(
        "UPDATE boards SET owner_id = "
        "(SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1)"
    )

    op.create_table(
        "board_members",
        sa.Column(
            "board_id",
            sa.Uuid(),
            sa.ForeignKey("boards.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("role", sa.String(20), nullable=False),
        _created_at(),
    )
    op.create_index("ix_board_members_user_id", "board_members", ["user_id"])

    op.create_table(
        "share_links",
        sa.Column("token", sa.String(64), primary_key=True),
        sa.Column(
            "board_id", sa.Uuid(), sa.ForeignKey("boards.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("role", sa.String(20), nullable=False),
        _created_at(),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_share_links_board_id", "share_links", ["board_id"])


def downgrade() -> None:
    op.drop_index("ix_share_links_board_id", table_name="share_links")
    op.drop_table("share_links")
    op.drop_index("ix_board_members_user_id", table_name="board_members")
    op.drop_table("board_members")
    op.drop_index("ix_boards_folder_id", table_name="boards")
    op.drop_index("ix_boards_owner_id", table_name="boards")
    with op.batch_alter_table("boards") as batch:
        batch.drop_constraint("fk_boards_folder_id", type_="foreignkey")
        batch.drop_constraint("fk_boards_owner_id", type_="foreignkey")
        batch.drop_column("folder_id")
        batch.drop_column("owner_id")
    op.drop_index("ix_folders_parent_id", table_name="folders")
    op.drop_index("ix_folders_owner_id", table_name="folders")
    op.drop_table("folders")
