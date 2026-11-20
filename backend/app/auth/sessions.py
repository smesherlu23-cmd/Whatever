"""Сессии входа: случайный токен в cookie, в базе — только его хеш."""

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Session, User

COOKIE_NAME = "whatever_session"


def token_hash(token: str) -> str:
    """Под этим ключом сессия хранится в базе."""
    return hashlib.sha256(token.encode()).hexdigest()


def _ttl() -> timedelta:
    return timedelta(days=get_settings().session_ttl_days)


async def create_session(db: AsyncSession, user: User) -> str:
    """Создаёт сессию и возвращает токен для cookie. Сам токен в базе не хранится."""
    now = datetime.now(UTC)
    # Заодно убираем истёкшие сессии, чтобы таблица не росла бесконечно.
    await db.execute(delete(Session).where(Session.expires_at < now))
    token = secrets.token_urlsafe(32)
    db.add(Session(token_hash=token_hash(token), user_id=user.id, expires_at=now + _ttl()))
    await db.commit()
    return token


def session_max_age() -> int:
    """Срок жизни cookie в секундах."""
    return int(_ttl().total_seconds())


async def user_for_token(db: AsyncSession, token: str) -> User | None:
    """Пользователь по токену сессии или None, если сессия истекла или пользователь заблокирован.

    Срок сессии продлевается, когда прошла половина: активные пользователи не выходят
    из системы, а база не пишется на каждый запрос.
    """
    row = (
        await db.execute(
            select(Session, User)
            .join(User, User.id == Session.user_id)
            .where(Session.token_hash == token_hash(token))
        )
    ).first()
    if row is None:
        return None
    session, user = row
    now = datetime.now(UTC)
    expires_at = session.expires_at.replace(tzinfo=session.expires_at.tzinfo or UTC)
    if expires_at <= now or not user.is_active:
        await db.delete(session)
        await db.commit()
        return None
    if expires_at - now < _ttl() / 2:
        session.expires_at = now + _ttl()
        await db.commit()
    return user


async def delete_session(db: AsyncSession, token: str) -> None:
    await db.execute(delete(Session).where(Session.token_hash == token_hash(token)))
    await db.commit()


async def delete_user_sessions(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Завершает все сессии пользователя: после блокировки или смены пароля.

    Не фиксирует транзакцию: вызывающий код делает это вместе с остальными изменениями.
    """
    await db.execute(delete(Session).where(Session.user_id == user_id))
