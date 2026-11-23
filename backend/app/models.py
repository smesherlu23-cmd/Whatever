import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import BigInteger, DateTime, Enum, ForeignKey, LargeBinary, String, false, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class Role(StrEnum):
    ADMIN = "admin"
    USER = "user"


class BoardRole(StrEnum):
    """Право участника доски, выданное владельцем или полученное по ссылке."""

    VIEWER = "viewer"
    EDITOR = "editor"


def _string_enum(enum: type[StrEnum]) -> Enum:
    """Перечисление хранится строкой его значения: так его легко читать и расширять."""
    return Enum(enum, native_enum=False, length=20, values_callable=lambda e: [m.value for m in e])


class User(Base):
    """Учётная запись. Создаёт администратор; самостоятельной регистрации нет."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Логин хранится в нижнем регистре: «Ivanov» и «ivanov» — один пользователь.
    login: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(_string_enum(Role), default=Role.USER)
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Session(Base):
    """Сессия входа. В базе хранится только хеш токена: утечка таблицы не даёт войти."""

    __tablename__ = "sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Folder(Base):
    """Личная папка для досок. Папки вкладываются друг в друга; чужих папок не видно."""

    __tablename__ = "folders"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("folders.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Board(Base):
    """Доска. Шаблон компании — тоже доска: его видят все, а копию с него получает новая доска."""

    __tablename__ = "boards"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200))
    # Без владельца доской управляют администраторы.
    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    # Папка владельца. Участники видят доску в общем списке «Доступные мне».
    folder_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("folders.id", ondelete="SET NULL"), index=True
    )
    # Шаблоны не попадают в списки досок, их выбирают при создании новой доски.
    is_template: Mapped[bool] = mapped_column(default=False, server_default=false())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Связи загружаются только явно (selectinload/joinedload): в асинхронном коде
    # неявный запрос к базе при обращении к атрибуту — ошибка, а не удобство.
    owner: Mapped[User | None] = relationship(lazy="raise")


class BoardMember(Base):
    """Доступ пользователя к чужой доске. Владелец здесь не записывается."""

    __tablename__ = "board_members"

    board_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("boards.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    role: Mapped[BoardRole] = mapped_column(_string_enum(BoardRole))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[User] = relationship(lazy="raise")


class ShareLink(Base):
    """Ссылка, по которой вошедший пользователь получает доступ к доске.

    Токен хранится как есть, чтобы владелец мог скопировать ссылку снова. Сама по себе
    ссылка не открывает доску: по ней нужно войти в систему, а доступ выдаётся участнику.
    """

    __tablename__ = "share_links"

    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    board_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("boards.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[BoardRole] = mapped_column(_string_enum(BoardRole))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Без срока ссылка действует, пока её не удалят.
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class BoardUpdate(Base):
    """Двоичная дельта Yjs. Состояние доски — все дельты по порядку id."""

    __tablename__ = "board_updates"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    board_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("boards.id", ondelete="CASCADE"), index=True
    )
    data: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BoardFile(Base):
    """Картинка или вложение на доске. Здесь описание файла, содержимое лежит на диске (app.files).

    id файла уникален в пределах доски: копия доски получает файлы под теми же id, и ссылки
    на них в содержимом доски переписывать не нужно.
    """

    __tablename__ = "board_files"

    board_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("boards.id", ondelete="CASCADE"), primary_key=True
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(100))
    size: Mapped[int] = mapped_column(BigInteger)
    # Файл остаётся на доске и после удаления учётной записи того, кто его загрузил.
    uploaded_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
