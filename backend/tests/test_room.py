"""Комната синхронизации на уровне Python: запись пачками, сжатие истории, сбои базы."""

import asyncio
import uuid
from collections.abc import AsyncIterator
from typing import Any

import pytest
from pycrdt import Doc, Map, create_sync_message, create_update_message
from sqlalchemy import delete, func, select

from app.core.config import get_settings
from app.core.db import Database, Sessions
from app.models import Board, BoardUpdate
from app.sync.room import Connection, Room, RoomManager, SavePolicy

COMPACT_AFTER = 50
# Запись почти без задержки: тесты ждут её доли секунды.
POLICY = SavePolicy(delay=0.01, compact_after=COMPACT_AFTER)


@pytest.fixture
async def sessions() -> AsyncIterator[Sessions]:
    # У каждого асинхронного теста свой цикл событий, а пул соединений привязан к циклу.
    database = Database(get_settings())
    yield database.sessions
    await database.dispose()


class Recorder:
    def __init__(self) -> None:
        self.messages: list[bytes] = []

    async def send(self, message: bytes) -> None:
        self.messages.append(message)


class Editor:
    """Клиентский документ, который выдаёт свои изменения как сообщения протокола."""

    def __init__(self) -> None:
        self.doc: Doc[Any] = Doc()
        self.elements = self.doc.get("elements", type=Map)

    def set(self, key: str, value: Any) -> bytes:
        updates: list[bytes] = []
        sub = self.doc.observe(lambda event: updates.append(event.update))
        self.elements[key] = value
        self.doc.unobserve(sub)
        (update,) = updates
        return update


async def new_board(sessions: Sessions) -> uuid.UUID:
    async with sessions() as session:
        board = Board(name="Тест")
        session.add(board)
        await session.commit()
        return board.id


async def stored_updates(sessions: Sessions, board_id: uuid.UUID) -> int:
    async with sessions() as session:
        count = await session.scalar(select(func.count()).where(BoardUpdate.board_id == board_id))
        return count or 0


async def store_history(sessions: Sessions, board_id: uuid.UUID, editor: Editor, size: int) -> None:
    async with sessions() as session:
        session.add_all(
            BoardUpdate(board_id=board_id, data=editor.set(f"shape-{i}", i)) for i in range(size)
        )
        await session.commit()


async def restored(sessions: Sessions, board_id: uuid.UUID) -> dict[str, Any]:
    room = Room(board_id, sessions, POLICY)
    await room.load()
    elements: dict[str, Any] = room.doc.get("elements", type=Map).to_py()
    return elements


async def test_changes_are_saved_in_one_batch(sessions: Sessions) -> None:
    board_id = await new_board(sessions)
    editor = Editor()
    rooms = RoomManager(sessions, POLICY)
    async with rooms.connect(board_id, Connection(Recorder().send)) as room:
        conn = next(iter(room.connections))
        for i in range(20):
            await room.receive(conn, create_update_message(editor.set(f"shape-{i}", i)))
        await asyncio.sleep(0.1)
        assert await stored_updates(sessions, board_id) == 1
    assert len(await restored(sessions, board_id)) == 20


async def test_history_is_compacted_when_the_room_closes(sessions: Sessions) -> None:
    board_id = await new_board(sessions)
    await store_history(sessions, board_id, Editor(), COMPACT_AFTER + 10)
    rooms = RoomManager(sessions, POLICY)
    async with rooms.connect(board_id, Connection(Recorder().send)):
        pass
    assert await stored_updates(sessions, board_id) == 1
    assert len(await restored(sessions, board_id)) == COMPACT_AFTER + 10


async def test_failed_load_keeps_the_history(
    sessions: Sessions, monkeypatch: pytest.MonkeyPatch
) -> None:
    board_id = await new_board(sessions)
    await store_history(sessions, board_id, Editor(), COMPACT_AFTER + 10)

    async def broken_load(self: Room) -> None:
        raise ConnectionError("database is down")

    monkeypatch.setattr(Room, "load", broken_load)
    rooms = RoomManager(sessions, POLICY)
    with pytest.raises(ConnectionError):
        async with rooms.connect(board_id, Connection(Recorder().send)):
            pass
    assert rooms.open_rooms() == 0

    monkeypatch.undo()
    assert await stored_updates(sessions, board_id) == COMPACT_AFTER + 10
    async with rooms.connect(board_id, Connection(Recorder().send)) as room:
        assert len(room.doc.get("elements", type=Map).to_py()) == COMPACT_AFTER + 10


async def test_failed_save_is_retried(sessions: Sessions, monkeypatch: pytest.MonkeyPatch) -> None:
    board_id = await new_board(sessions)
    editor = Editor()
    original = Room._persist
    failures = 0

    async def flaky_persist(self: Room, data: bytes) -> None:
        nonlocal failures
        if failures == 0:
            failures += 1
            raise ConnectionError("database is down")
        await original(self, data)

    monkeypatch.setattr(Room, "_persist", flaky_persist)
    rooms = RoomManager(sessions, POLICY)
    async with rooms.connect(board_id, Connection(Recorder().send)) as room:
        conn = next(iter(room.connections))
        await room.receive(conn, create_update_message(editor.set("shape", 1)))
        await asyncio.sleep(0.1)
        assert failures == 1
        assert await stored_updates(sessions, board_id) == 1


async def test_a_new_participant_receives_the_document_state(sessions: Sessions) -> None:
    board_id = await new_board(sessions)
    first, second = Recorder(), Recorder()
    rooms = RoomManager(sessions, POLICY)
    async with rooms.connect(board_id, Connection(first.send)):
        async with rooms.connect(board_id, Connection(second.send)) as room:
            assert len(room.connections) == 2
            assert second.messages, "the server sends sync step 1 first"
        assert rooms.open_rooms() == 1
    assert rooms.open_rooms() == 0


async def test_read_only_connection_cannot_change_the_document(sessions: Sessions) -> None:
    board_id = await new_board(sessions)
    editor, viewer_inbox, other_inbox = Editor(), Recorder(), Recorder()
    rooms = RoomManager(sessions, POLICY)
    viewer = Connection(viewer_inbox.send, can_edit=False)
    async with (
        rooms.connect(board_id, Connection(other_inbox.send)),
        rooms.connect(board_id, viewer) as room,
    ):
        other_inbox.messages.clear()
        await room.receive(viewer, create_update_message(editor.set("shape", 1)))
        assert room.doc.get("elements", type=Map).to_py() == {}
        assert other_inbox.messages == []
        # На запрос недостающего (шаг 1) зритель ответ получает.
        viewer_inbox.messages.clear()
        await room.receive(viewer, create_sync_message(editor.doc))
        assert viewer_inbox.messages
    assert await stored_updates(sessions, board_id) == 0


async def test_discarded_room_does_not_write_to_a_deleted_board(sessions: Sessions) -> None:
    board_id = await new_board(sessions)
    editor = Editor()
    rooms = RoomManager(sessions, POLICY)
    async with rooms.connect(board_id, Connection(Recorder().send)) as room:
        conn = next(iter(room.connections))
        await room.receive(conn, create_update_message(editor.set("shape", 1)))
        async with sessions() as session:
            await session.execute(delete(Board).where(Board.id == board_id))
            await session.commit()
        # Без discard закрытие комнаты попыталось бы записать изменение и упало бы
        # на внешнем ключе удалённой доски.
        rooms.discard(board_id)
    assert rooms.open_rooms() == 0


async def test_flush_writes_accepted_changes_at_once(sessions: Sessions) -> None:
    board_id = await new_board(sessions)
    # Без flush комната записала бы изменения только через минуту.
    rooms = RoomManager(sessions, SavePolicy(delay=60, compact_after=COMPACT_AFTER))
    await rooms.flush(board_id)
    async with rooms.connect(board_id, Connection(Recorder().send)) as room:
        conn = next(iter(room.connections))
        await room.receive(conn, create_update_message(Editor().set("shape", 1)))
        assert await stored_updates(sessions, board_id) == 0
        await rooms.flush(board_id)
        assert await stored_updates(sessions, board_id) == 1
        assert await restored(sessions, board_id) == {"shape": 1}


async def test_flush_waits_for_a_closing_room(
    sessions: Sessions, monkeypatch: pytest.MonkeyPatch
) -> None:
    board_id = await new_board(sessions)
    rooms = RoomManager(sessions, SavePolicy(delay=60, compact_after=COMPACT_AFTER))
    connection = rooms.connect(board_id, Connection(Recorder().send))
    room = await connection.__aenter__()
    await room.receive(next(iter(room.connections)), create_update_message(Editor().set("a", 1)))
    closing = asyncio.Event()
    close = room.close

    async def close_later() -> None:
        closing.set()
        await close()

    monkeypatch.setattr(room, "close", close_later)
    leaving = asyncio.create_task(connection.__aexit__(None, None, None))
    await closing.wait()
    # Комната уже закрывается и сама дописывает изменения: flush дожидается этого.
    await rooms.flush(board_id)
    assert await restored(sessions, board_id) == {"a": 1}
    await leaving
