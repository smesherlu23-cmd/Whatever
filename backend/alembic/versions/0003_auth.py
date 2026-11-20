"""Вход по логину и паролю: логин вместо email, блокировка, сессии

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-20
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # batch_alter_table нужен SQLite (тесты): там изменение столбца — пересоздание таблицы.
    # Индексы снимаются до него и создаются после, иначе batch ищет старое имя столбца.
    op.drop_index("ix_users_email", table_name="users")
    with op.batch_alter_table("users") as batch:
        batch.alter_column(
            "email",
            new_column_name="login",
            existing_type=sa.String(320),
            type_=sa.String(100),
            existing_nullable=False,
        )
        batch.add_column(
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true())
        )
    op.create_index("ix_users_login", "users", ["login"], unique=True)

    op.create_table(
        "sessions",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_sessions_user_id", table_name="sessions")
    op.drop_table("sessions")
    op.drop_index("ix_users_login", table_name="users")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("is_active")
        batch.alter_column(
            "login",
            new_column_name="email",
            existing_type=sa.String(100),
            type_=sa.String(320),
            existing_nullable=False,
        )
    op.create_index("ix_users_email", "users", ["email"], unique=True)
