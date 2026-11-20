import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, LargeBinary, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

# В SQLite (тесты) автоинкремент работает только у INTEGER.
BigIntId = BigInteger().with_variant(Integer, "sqlite")


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="user")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Board(Base):
    __tablename__ = "boards"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BoardUpdate(Base):
    """Двоичная дельта Yjs. Состояние доски — все дельты по порядку id."""

    __tablename__ = "board_updates"

    id: Mapped[int] = mapped_column(BigIntId, primary_key=True, autoincrement=True)
    board_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("boards.id", ondelete="CASCADE"), index=True
    )
    data: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
