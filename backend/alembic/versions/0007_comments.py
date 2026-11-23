"""Обсуждения, упоминания и уведомления

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-23
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _created_at() -> sa.Column[sa.DateTime]:
    return sa.Column(
        "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


def upgrade() -> None:
    op.create_table(
        "comment_threads",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "board_id",
            sa.Uuid(),
            sa.ForeignKey("boards.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("page", sa.String(100), nullable=False),
        sa.Column("x", sa.Float(), nullable=False),
        sa.Column("y", sa.Float(), nullable=False),
        sa.Column("element_id", sa.String(100)),
        sa.Column("element_x", sa.Float()),
        sa.Column("element_y", sa.Float()),
        sa.Column("author_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
        sa.Column("resolved_by_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        _created_at(),
        sa.CheckConstraint(
            "(element_id IS NULL) = (element_x IS NULL) "
            "AND (element_id IS NULL) = (element_y IS NULL)",
            name="ck_comment_threads_element_anchor",
        ),
    )
    op.create_index("ix_comment_threads_board_id", "comment_threads", ["board_id"])
    op.create_index("ix_comment_threads_author_id", "comment_threads", ["author_id"])
    op.create_index("ix_comment_threads_resolved_by_id", "comment_threads", ["resolved_by_id"])

    op.create_table(
        "comments",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "thread_id",
            sa.Uuid(),
            sa.ForeignKey("comment_threads.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("author_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("text", sa.Text(), nullable=False),
        _created_at(),
        sa.Column("edited_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_comments_thread_id", "comments", ["thread_id"])
    op.create_index("ix_comments_author_id", "comments", ["author_id"])

    op.create_table(
        "comment_mentions",
        sa.Column(
            "comment_id",
            sa.Uuid(),
            sa.ForeignKey("comments.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
        ),
    )
    op.create_index("ix_comment_mentions_user_id", "comment_mentions", ["user_id"])

    op.create_table(
        "notifications",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "comment_id",
            sa.Uuid(),
            sa.ForeignKey("comments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True)),
        _created_at(),
        sa.UniqueConstraint("user_id", "comment_id", name="uq_notifications_user_comment"),
    )
    op.create_index("ix_notifications_user_created", "notifications", ["user_id", "created_at"])
    op.create_index("ix_notifications_comment_id", "notifications", ["comment_id"])


def downgrade() -> None:
    op.drop_table("notifications")
    op.drop_table("comment_mentions")
    op.drop_table("comments")
    op.drop_table("comment_threads")
