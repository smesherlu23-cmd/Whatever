"""Хеширование паролей алгоритмом Argon2id.

Хеширование намеренно медленное (десятки миллисекунд и 64 МиБ памяти на одну проверку),
поэтому выполняется в потоках и не останавливает обработку остальных запросов и синхронизацию
досок. Потоков для него отдельный небольшой пул: поток попыток входа займёт не больше
HASH_THREADS ядер и не вытеснит запись файлов, которая идёт в общем пуле asyncio.to_thread.
"""

import asyncio
import secrets
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from functools import partial

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

MIN_LENGTH = 8
# Верхняя граница защищает от запросов с огромным паролем, которые заняли бы процессор.
MAX_LENGTH = 128

# Одновременных вычислений Argon2. Остальные проверки ждут очереди, а не занимают память.
HASH_THREADS = 2

_hasher = PasswordHasher()
_pool = ThreadPoolExecutor(max_workers=HASH_THREADS, thread_name_prefix="argon2")
# Хеш случайного пароля: проверка для несуществующего логина занимает столько же времени,
# сколько для существующего, и по времени ответа нельзя узнать, какие логины есть.
_DUMMY_HASH = _hasher.hash(secrets.token_hex(16))


async def _in_pool[**P, T](function: Callable[P, T], *args: P.args, **kwargs: P.kwargs) -> T:
    call = partial(function, *args, **kwargs)
    return await asyncio.get_running_loop().run_in_executor(_pool, call)


async def hash_password(password: str) -> str:
    return await _in_pool(_hasher.hash, password)


async def verify_password(password_hash: str | None, password: str) -> bool:
    """Проверяет пароль. Без хеша сверяет с заглушкой, чтобы время ответа не отличалось."""
    try:
        matches = await _in_pool(_hasher.verify, password_hash or _DUMMY_HASH, password)
    except (VerificationError, InvalidHashError):
        return False
    return matches and password_hash is not None


def needs_rehash(password_hash: str) -> bool:
    """Нужно ли пересчитать хеш, потому что параметры Argon2 стали строже."""
    return _hasher.check_needs_rehash(password_hash)
