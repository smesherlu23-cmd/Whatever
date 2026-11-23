"""Ограничения на то, что присылает одно подключение к доске.

Документ и присутствие приходят от браузеров, а браузер может быть неисправен или чужим.
Без ограничений один клиент мог бы раздуть комнату огромным состоянием присутствия или
засыпать остальных участников сообщениями: сервер рассылает их всем.
"""

import time
from collections.abc import Callable

# Наибольшее сообщение по WebSocket. Снимок большой доски при первой синхронизации весит
# сотни килобайт; всё, что больше, сервер не примет и закроет подключение (код 1009).
WS_MAX_MESSAGE_BYTES = 4 * 1024 * 1024

# Присутствие — имя, цвет, страница, курсор, видимая часть доски и выделение. Даже
# выделение из тысячи фигур занимает около 40 КБ.
AWARENESS_MAX_BYTES = 64 * 1024

# Клиент шлёт курсор не чаще 20 раз в секунду; запас — на выделение и смену страницы.
AWARENESS_PER_SECOND = 30.0
AWARENESS_BURST = 60.0


class RateLimit:
    """Ведро токенов: rate событий в секунду в среднем и не больше burst подряд."""

    def __init__(
        self,
        rate: float,
        burst: float,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._rate = rate
        self._burst = burst
        self._clock = clock
        self._tokens = burst
        self._updated = clock()

    def allow(self) -> bool:
        now = self._clock()
        self._tokens = min(self._burst, self._tokens + (now - self._updated) * self._rate)
        self._updated = now
        if self._tokens < 1:
            return False
        self._tokens -= 1
        return True
