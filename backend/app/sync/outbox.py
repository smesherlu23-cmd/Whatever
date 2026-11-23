"""Очередь исходящих сообщений одного WebSocket-подключения.

Комната рассылает изменение всем участникам. Если ждать отправки каждому, один медленный
клиент (уснувший ноутбук, плохой Wi-Fi, заполненный буфер TCP) задержал бы рассылку
для всех остальных участников доски. Поэтому у каждого подключения своя очередь
и своя задача, которая её разбирает: комната только кладёт сообщение и идёт дальше.

Очередь ограничена по объёму. Клиент, который отстал больше чем на limit байт, отключается:
при переподключении протокол Yjs сам дошлёт ему всё, чего у него нет, а держать
бесконечный хвост в памяти сервера нельзя.
"""

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator, Awaitable, Callable

log = logging.getLogger(__name__)

Send = Callable[[bytes], Awaitable[None]]


class Outbox:
    """Отправляет сообщения по порядку в своей задаче. send не ждёт сети."""

    def __init__(self, send: Send, *, limit: int, on_overflow: Callable[[], None]) -> None:
        self._send = send
        self._limit = limit
        self._on_overflow = on_overflow
        self._queue: asyncio.Queue[bytes] = asyncio.Queue()
        self._queued_bytes = 0
        self._overflowed = False

    @property
    def queued_bytes(self) -> int:
        return self._queued_bytes

    async def send(self, message: bytes) -> None:
        """Ставит сообщение в очередь. Сигнатура совпадает с WebSocket.send_bytes."""
        if self._overflowed:
            return
        if self._queued_bytes + len(message) > self._limit:
            self._overflow()
            return
        self._queued_bytes += len(message)
        self._queue.put_nowait(message)

    def _overflow(self) -> None:
        self._overflowed = True
        # Ничего из очереди этому клиенту уже не понадобится: он подключится заново.
        while not self._queue.empty():
            self._queue.get_nowait()
        self._queued_bytes = 0
        log.info("a slow client fell behind by more than %d bytes, disconnecting it", self._limit)
        self._on_overflow()

    async def _drain(self) -> None:
        while True:
            message = await self._queue.get()
            self._queued_bytes -= len(message)
            await self._send(message)

    @contextlib.asynccontextmanager
    async def running(self) -> AsyncIterator[None]:
        """Разбирает очередь, пока открыт блок with. Сбой отправки (клиент отключился)
        останавливает разбор; само подключение закроет его обработчик."""
        task = asyncio.create_task(self._drain())
        try:
            yield
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
