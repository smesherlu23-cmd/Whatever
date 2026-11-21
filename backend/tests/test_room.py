"""Комната синхронизации на уровне Python: запись пачками, сжатие истории, сбои базы."""

import asyncio
import uuid
from collections.abc import AsyncIterator
from typing import Any

import pytest
from pycrdt import Doc, Map, create_sync_message, create_update_message
from sqlalchemy import delete, func, select

from app.db import dispose_engine, session_factory
from app.models import Board, BoardUpdate
from app.sync import room as room_module
from app.sync.room import COMPACT_AFTER, Connection, Room, RoomManager


@pytest.fixture(autouse=True)
async def fresh_engine() -> AsyncIterator[None]:
    # У каждого асинхронного теста свой цикл событий, а пул соединений привязан к циклу.
    yield
    await dispose_engine()


@pytest.fixture
def fast_saves(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(room_module, "SAVE_DELAY_SECONDS", 0.01)


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


async def new_board() -> uuid.UUID:
    async with session_factory()() as session:
        board = Board(name="Тест")
        session.add(board)
        await session.commit()
        return board.id


async def stored_updates(board_id: uuid.UUID) -> int:
    async with session_factory()() as session:
        count = await session.scalar(select(func.count()).where(BoardUpdate.board_id == board_id))
        return count or 0


async def store_history(board_id: uuid.UUID, editor: Editor, size: int) -> None:
    async with session_factory()() as session:
        session.add_all(
            BoardUpdate(board_id=board_id, data=editor.set(f"shape-{i}", i)) for i in range(size)
        )
        await session.commit()


async def restored(board_id: uuid.UUID) -> dict[str, Any]:
    room = Room(board_id, session_factory())
    await room.load()
    elements: dict[str, Any] = room.doc.get("elements", type=Map).to_py()
    return elements


@pytest.mark.usefixtures("fast_saves")
async def test_changes_are_saved_in_one_batch() -> None:
    board_id = await new_board()
    editor = Editor()
    rooms = RoomManager(session_factory)
    async with rooms.connect(board_id, Connection(Recorder().send)) as room:
        conn = next(iter(room.connections))
        for i in range(20):
            await room.receive(conn, create_update_message(editor.set(f"shape-{i}", i)))
        await asyncio.sleep(0.1)
        assert await stored_updates(board_id) == 1
    assert len(await restored(board_id)) == 20


async def test_history_is_compacted_when_the_room_closes() -> None:
    board_id = await new_board()
    await store_history(board_id, Editor(), COMPACT_AFTER + 10)
    rooms = RoomManager(session_factory)
    async with rooms.connect(board_id, Connection(Recorder().send)):
        pass
    assert await stored_updates(board_id) == 1
    assert len(await restored(board_id)) == COMPACT_AFTER + 10


async def test_failed_load_keeps_the_history(monkeypatch: pytest.MonkeyPatch) -> None:
    board_id = await new_board()
    await store_history(board_id, Editor(), COMPACT_AFTER + 10)

    async def broken_load(self: Room) -> None:
        raise ConnectionError("database is down")

    monkeypatch.setattr(Room, "load", broken_load)
    rooms = RoomManager(session_factory)
    with pytest.raises(ConnectionError):
        async with rooms.connect(board_id, Connection(Recorder().send)):
            pass
    assert rooms.open_rooms() == 0

    monkeypatch.undo()
    assert await stored_updates(board_id) == COMPACT_AFTER + 10
    async with rooms.connect(board_id, Connection(Recorder().send)) as room:
        assert len(room.doc.get("elements", type=Map).to_py()) == COMPACT_AFTER + 10


@pytest.mark.usefixtures("fast_saves")
async def test_failed_save_is_retried(monkeypatch: pytest.MonkeyPatch) -> None:
    board_id = await new_board()
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
    rooms = RoomManager(session_factory)
    async with rooms.connect(board_id, Connection(Recorder().send)) as room:
        conn = next(iter(room.connections))
        await room.receive(conn, create_update_message(editor.set("shape", 1)))
        await asyncio.sleep(0.1)
        assert failures == 1
        assert await stored_updates(board_id) == 1


async def test_a_new_participant_receives_the_document_state() -> None:
    board_id = await new_board()
    first, second = Recorder(), Recorder()
    rooms = RoomManager(session_factory)
    async with rooms.connect(board_id, Connection(first.send)):
        async with rooms.connect(board_id, Connection(second.send)) as room:
            assert len(room.connections) == 2
            assert second.messages, "the server sends sync step 1 first"
        assert rooms.open_rooms() == 1
    assert rooms.open_rooms() == 0


async def test_read_only_connection_cannot_change_the_document() -> None:
    board_id = await new_board()
    editor, viewer_inbox, other_inbox = Editor(), Recorder(), Recorder()
    rooms = RoomManager(session_factory)
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
    assert await stored_updates(board_id) == 0


async def test_discarded_room_does_not_write_to_a_deleted_board() -> None:
    board_id = await new_board()
    editor = Editor()
    rooms = RoomManager(session_factory)
    async with rooms.connect(board_id, Connection(Recorder().send)) as room:
        conn = next(iter(room.connections))
        await room.receive(conn, create_update_message(editor.set("shape", 1)))
        async with session_factory()() as session:
            await session.execute(delete(Board).where(Board.id == board_id))
            await session.commit()
        # Без discard закрытие комнаты попыталось бы записать изменение и упало бы
        # на внешнем ключе удалённой доски.
        rooms.discard(board_id)
    assert rooms.open_rooms() == 0
