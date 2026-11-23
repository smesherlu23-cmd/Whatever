"""Очередь исходящих сообщений: медленный клиент не задерживает остальных."""

import asyncio

from app.sync.outbox import Outbox


class Inbox:
    def __init__(self) -> None:
        self.messages: list[bytes] = []

    async def send(self, message: bytes) -> None:
        self.messages.append(message)


class Stuck:
    """Клиент, который перестал принимать данные: отправка ему не завершается никогда."""

    def __init__(self) -> None:
        self.started = 0

    async def send(self, message: bytes) -> None:  # noqa: ARG002
        self.started += 1
        await asyncio.Event().wait()


class Overflows:
    def __init__(self) -> None:
        self.count = 0

    def __call__(self) -> None:
        self.count += 1


async def settle() -> None:
    """Даёт задаче разбора очереди отработать всё, что можно отправить сразу."""
    for _ in range(5):
        await asyncio.sleep(0)


async def test_sends_messages_in_order() -> None:
    inbox = Inbox()
    outbox = Outbox(inbox.send, limit=1024, on_overflow=Overflows())
    async with outbox.running():
        for message in (b"one", b"two", b"three"):
            await outbox.send(message)
        await settle()
    assert inbox.messages == [b"one", b"two", b"three"]
    assert outbox.queued_bytes == 0


async def test_a_stuck_client_is_disconnected_once_it_falls_too_far_behind() -> None:
    client, overflows = Stuck(), Overflows()
    outbox = Outbox(client.send, limit=10, on_overflow=overflows)
    async with outbox.running():
        await outbox.send(b"12345")  # уходит в отправку и застревает
        await settle()
        await outbox.send(b"12345")
        await outbox.send(b"12345")
        assert overflows.count == 0
        await outbox.send(b"1")  # 5 + 5 + 1 > 10
        assert overflows.count == 1
        assert outbox.queued_bytes == 0
        # Отключённому клиенту больше ничего не копится.
        await outbox.send(b"12345")
        assert overflows.count == 1
        assert outbox.queued_bytes == 0
    assert client.started == 1


async def test_a_failed_send_stops_the_outbox_quietly() -> None:
    async def broken(message: bytes) -> None:
        raise ConnectionResetError

    outbox = Outbox(broken, limit=1024, on_overflow=Overflows())
    async with outbox.running():
        await outbox.send(b"hello")
        await settle()
