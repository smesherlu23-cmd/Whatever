import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    false,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class Role(StrEnum):
    ADMIN = "admin"
    USER = "user"


class BoardRole(StrEnum):
    """Право участника доски, выданное владельцем или полученное по ссылке."""

    VIEWER = "viewer"
    EDITOR = "editor"


class NotificationKind(StrEnum):
    MENTION = "mention"
    """Пользователя упомянули в комментарии."""
    REPLY = "reply"
    """Ответили в обсуждении, которое пользователь начал или где он писал."""


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
    # Доска загружается запросом WHERE board_id ORDER BY id: индекс отдаёт строки уже
    # по порядку, без сортировки.
    __table_args__ = (Index("ix_board_updates_board_id_id", "board_id", "id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    board_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("boards.id", ondelete="CASCADE"))
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


class BoardVersion(Base):
    """Версия доски: всё её содержимое в какой-то момент, одним обновлением Yjs.

    Автоматические версии (без названия) комната доски сохраняет сама, пока доску меняют,
    и удаляет, когда они старше срока хранения. Названные версии сохраняют люди, и хранятся они,
    пока их не удалят.
    """

    __tablename__ = "board_versions"
    __table_args__ = (Index("ix_board_versions_board_created", "board_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    board_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("boards.id", ondelete="CASCADE"))
    name: Mapped[str | None] = mapped_column(String(200))
    # Содержимое большое, а список версий его не показывает: читается только явно.
    state: Mapped[bytes] = mapped_column(LargeBinary, deferred=True, deferred_raiseload=True)
    # Время базы, как у board_updates: по нему видно, есть ли правки новее последней версии.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Кто сохранил версию вручную. У автоматических версий его нет.
    saved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )

    saved_by: Mapped[User | None] = relationship(lazy="raise")
    # Кто менял доску после предыдущей версии.
    editors: Mapped[list[User]] = relationship(
        secondary="board_version_editors", lazy="raise", order_by="User.name", viewonly=True
    )


class BoardVersionEditor(Base):
    __tablename__ = "board_version_editors"

    version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("board_versions.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True
    )


class CommentThread(Base):
    """Обсуждение на доске: метка на странице и комментарии к ней по порядку.

    Метку ставят в точку страницы (x, y) или на элемент. Метка элемента ездит вместе с ним:
    её место на элементе — доли его ширины и высоты от левого верхнего угла (element_x,
    element_y). Если элемент удалят, метка останется в точке, где её поставили.
    Страница и элемент — id из документа доски, поэтому внешних ключей у них нет.
    """

    __tablename__ = "comment_threads"
    __table_args__ = (
        CheckConstraint(
            "(element_id IS NULL) = (element_x IS NULL) "
            "AND (element_id IS NULL) = (element_y IS NULL)",
            name="ck_comment_threads_element_anchor",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    board_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("boards.id", ondelete="CASCADE"), index=True
    )
    page: Mapped[str] = mapped_column(String(100))
    x: Mapped[float]
    y: Mapped[float]
    element_id: Mapped[str | None] = mapped_column(String(100))
    element_x: Mapped[float | None]
    element_y: Mapped[float | None]
    # Обсуждение остаётся на доске и после удаления учётной записи того, кто его начал.
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    author: Mapped[User | None] = relationship(lazy="raise", foreign_keys=[author_id])
    resolved_by: Mapped[User | None] = relationship(lazy="raise", foreign_keys=[resolved_by_id])
    comments: Mapped[list["Comment"]] = relationship(
        lazy="raise", order_by="Comment.created_at", passive_deletes=True
    )


class Comment(Base):
    """Комментарий в обсуждении. Первый комментарий — вопрос, с которого обсуждение началось."""

    __tablename__ = "comments"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    thread_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("comment_threads.id", ondelete="CASCADE"), index=True
    )
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    author: Mapped[User | None] = relationship(lazy="raise")
    # Упомянутые через @логин: их имена выделяются в тексте, и они получают уведомление.
    mentioned: Mapped[list[User]] = relationship(
        secondary="comment_mentions", lazy="raise", order_by="User.login", viewonly=True
    )


class CommentMention(Base):
    """Кого упомянули в комментарии. Упомянуть можно только того, кто может открыть доску."""

    __tablename__ = "comment_mentions"

    comment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("comments.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True
    )


class Notification(Base):
    """Уведомление в колокольчике: упоминание или ответ в обсуждении.

    На один комментарий у пользователя не больше одного уведомления. Удалили комментарий —
    исчезает и уведомление о нём.
    """

    __tablename__ = "notifications"
    __table_args__ = (
        UniqueConstraint("user_id", "comment_id", name="uq_notifications_user_comment"),
        # Колокольчик показывает последние уведомления пользователя.
        Index("ix_notifications_user_created", "user_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    comment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("comments.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[NotificationKind] = mapped_column(_string_enum(NotificationKind))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    comment: Mapped[Comment] = relationship(lazy="raise")
