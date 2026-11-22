"""Защита от подбора пароля."""

import time
from collections.abc import Callable
from datetime import timedelta

# Предел числа отслеживаемых ключей: память не растёт от перебора случайных логинов.
MAX_KEYS = 10_000


class LoginThrottle:
    """Считает неудачные попытки входа по паре «логин + адрес».

    После max_failures неудач за window вход с этой парой временно закрыт. Ключ включает
    адрес, чтобы посторонний не мог заблокировать чужой логин со своего компьютера.
    Счётчики живут в памяти процесса: бэкенд работает одним процессом.
    """

    def __init__(
        self,
        *,
        max_failures: int,
        window: timedelta,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._max_failures = max_failures
        self._window = window.total_seconds()
        self._clock = clock
        self._failures: dict[str, list[float]] = {}

    def retry_after(self, key: str) -> int:
        """Через сколько секунд можно снова пытаться войти; 0 — можно сейчас."""
        attempts = self._recent(key)
        if len(attempts) < self._max_failures:
            return 0
        return max(1, int(attempts[0] + self._window - self._clock()) + 1)

    def failed(self, key: str) -> None:
        if len(self._failures) >= MAX_KEYS:
            self._forget_stale()
        self._failures.setdefault(key, []).append(self._clock())

    def succeeded(self, key: str) -> None:
        self._failures.pop(key, None)

    def _recent(self, key: str) -> list[float]:
        cutoff = self._clock() - self._window
        attempts = [t for t in self._failures.get(key, []) if t > cutoff]
        if attempts:
            self._failures[key] = attempts
        else:
            self._failures.pop(key, None)
        return attempts

    def _forget_stale(self) -> None:
        for key in list(self._failures):
            self._recent(key)
        if len(self._failures) >= MAX_KEYS:
            self._failures.clear()
