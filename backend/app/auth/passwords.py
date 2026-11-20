"""Хеширование паролей алгоритмом Argon2id.

Хеширование намеренно медленное (десятки миллисекунд), поэтому выполняется в пуле потоков
и не останавливает обработку остальных запросов и синхронизацию досок.
"""

import asyncio
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

MIN_LENGTH = 8
# Верхняя граница защищает от запросов с огромным паролем, которые заняли бы процессор.
MAX_LENGTH = 128

_hasher = PasswordHasher()
# Хеш случайного пароля: проверка для несуществующего логина занимает столько же времени,
# сколько для существующего, и по времени ответа нельзя узнать, какие логины есть.
_DUMMY_HASH = _hasher.hash(secrets.token_hex(16))


async def hash_password(password: str) -> str:
    return await asyncio.to_thread(_hasher.hash, password)


async def verify_password(password_hash: str | None, password: str) -> bool:
    """Проверяет пароль. Без хеша сверяет с заглушкой, чтобы время ответа не отличалось."""
    try:
        matches = await asyncio.to_thread(_hasher.verify, password_hash or _DUMMY_HASH, password)
    except (VerificationError, InvalidHashError):
        return False
    return matches and password_hash is not None


def needs_rehash(password_hash: str) -> bool:
    """Нужно ли пересчитать хеш, потому что параметры Argon2 стали строже."""
    return _hasher.check_needs_rehash(password_hash)
