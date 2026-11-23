"""Комната синхронизации на уровне Python: запись пачками, сжатие истории, сбои базы."""

import asyncio
import uuid
from collections.abc import AsyncIterator
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Any, NamedTuple

import pytest
from pycrdt import Doc, Map, create_sync_message, create_update_message
from sqlalchemy import delete, func, select
from sqlalchemy.orm import selectinload, undefer

from app.core.config import get_settings
from app.core.db import Database, Sessions
from app.models import Board, BoardUpdate, BoardVersion, User
from app.sync.room import VERSIONS_CHANGED, Connection, Room, RoomManager, SavePolicy
from app.versions import save_version

# Комната записывает версии через save_version, импортированную в свой модуль.
ROOM_SAVE_VERSION = "app.sync.room.save_version"

COMPACT_AFTER = 50
# Запись почти без задержки: тесты ждут её доли секунды. Версии — как на сервере, раз в
# десять минут: тесты, которым нужны версии, задают свой интервал.
POLICY = SavePolicy(
    delay=0.01,
    compact_after=COMPACT_AFTER,
    version_interval=timedelta(minutes=10),
    version_retention=timedelta(days=30),
)


@pytest.fixture
async def sessions() -> AsyncIterator[Sessions]:
    # У каждого асинхронного теста свой цикл событий, а пул соединений привязан к циклу.
    database = Database(get_settings())
    yield database.sessions
    await database.dispose()


@pytest.fixture
async def someone(sessions: Sessions) -> uuid.UUID:
    """Пользователь, который подключается к доске: версии помнят, кто её менял."""
    async with sessions() as session:
        user = User(login=f"room-{uuid.uuid4().hex[:8]}", name="Участник", password_hash="-")
        session.add(user)
        await session.commit()
        return user.id


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


class Saved(NamedTuple):
    """Версия доски глазами теста."""

    name: str | None
    saved_by: uuid.UUID | None
    editors: set[uuid.UUID]
    elements: dict[str, Any]


async def saved_versions(sessions: Sessions, board_id: uuid.UUID) -> list[Saved]:
    async with sessions() as session:
        versions = await session.scalars(
            select(BoardVersion)
            .options(undefer(BoardVersion.state), selectinload(BoardVersion.editors))
            .where(BoardVersion.board_id == board_id)
            .order_by(BoardVersion.created_at)
        )
        saved = []
        for version in versions:
            doc: Doc[Any] = Doc()
            doc.apply_update(version.state)
            elements: dict[str, Any] = doc.get("elements", type=Map).to_py()
            editors = {user.id for user in version.editors}
            saved.append(Saved(version.name, version.saved_by_id, editors, elements))
        return saved


async def restored(sessions: Sessions, board_id: uuid.UUID) -> dict[str, Any]:
    room = Room(board_id, sessions, POLICY)
    await room.load()
    elements: dict[str, Any] = room.doc.get("elements", type=Map).to_py()
    return elements


async def test_changes_are_saved_in_one_batch(sessions: Sessions, someone: uuid.UUID) -> None:
    board_id = await new_board(sessions)
    editor = Editor()
    rooms = RoomManager(sessions, POLICY)
    async with rooms.connect(board_id, Connection(Recorder().send, someone)) as room:
        conn = next(iter(room.connections))
        for i in range(20):
            await room.receive(conn, create_update_message(editor.set(f"shape-{i}", i)))
        await asyncio.sleep(0.1)
        assert await stored_updates(sessions, board_id) == 1
    assert len(await restored(sessions, board_id)) == 20


async def test_history_is_compacted_when_the_room_closes(
    sessions: Sessions, someone: uuid.UUID
) -> None:
    board_id = await new_board(sessions)
    await store_history(sessions, board_id, Editor(), COMPACT_AFTER + 10)
    rooms = RoomManager(sessions, POLICY)
    async with rooms.connect(board_id, Connection(Recorder().send, someone)):
        pass
    assert await stored_updates(sessions, board_id) == 1
    assert len(await restored(sessions, board_id)) == COMPACT_AFTER + 10


async def test_failed_load_keeps_the_history(
    sessions: Sessions, monkeypatch: pytest.MonkeyPatch, someone: uuid.UUID
) -> None:
    board_id = await new_board(sessions)
    await store_history(sessions, board_id, Editor(), COMPACT_AFTER + 10)

    async def broken_load(self: Room) -> None:
        raise ConnectionError("database is down")

    monkeypatch.setattr(Room, "load", broken_load)
    rooms = RoomManager(sessions, POLICY)
    with pytest.raises(ConnectionError):
        async with rooms.connect(board_id, Connection(Recorder().send, someone)):
            pass
    assert rooms.open_rooms() == 0

    monkeypatch.undo()
    assert await stored_updates(sessions, board_id) == COMPACT_AFTER + 10
    async with rooms.connect(board_id, Connection(Recorder().send, someone)) as room:
        assert len(room.doc.get("elements", type=Map).to_py()) == COMPACT_AFTER + 10


async def test_failed_save_is_retried(
    sessions: Sessions, monkeypatch: pytest.MonkeyPatch, someone: uuid.UUID
) -> None:
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
    async with rooms.connect(board_id, Connection(Recorder().send, someone)) as room:
        conn = next(iter(room.connections))
        await room.receive(conn, create_update_message(editor.set("shape", 1)))
        await asyncio.sleep(0.1)
        assert failures == 1
        assert await stored_updates(sessions, board_id) == 1


async def test_a_new_participant_receives_the_document_state(
    sessions: Sessions, someone: uuid.UUID
) -> None:
    board_id = await new_board(sessions)
    first, second = Recorder(), Recorder()
    rooms = RoomManager(sessions, POLICY)
    async with rooms.connect(board_id, Connection(first.send, someone)):
        async with rooms.connect(board_id, Connection(second.send, someone)) as room:
            assert len(room.connections) == 2
            assert second.messages, "the server sends sync step 1 first"
        assert rooms.open_rooms() == 1
    assert rooms.open_rooms() == 0


async def test_read_only_connection_cannot_change_the_document(
    sessions: Sessions, someone: uuid.UUID
) -> None:
    board_id = await new_board(sessions)
    editor, viewer_inbox, other_inbox = Editor(), Recorder(), Recorder()
    rooms = RoomManager(sessions, POLICY)
    viewer = Connection(viewer_inbox.send, someone, can_edit=False)
    async with (
        rooms.connect(board_id, Connection(other_inbox.send, someone)),
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
    # Отброшенное изменение — не изменение: версии нет.
    assert await saved_versions(sessions, board_id) == []


async def test_discarded_room_does_not_write_to_a_deleted_board(
    sessions: Sessions, someone: uuid.UUID
) -> None:
    board_id = await new_board(sessions)
    editor = Editor()
    rooms = RoomManager(sessions, POLICY)
    async with rooms.connect(board_id, Connection(Recorder().send, someone)) as room:
        conn = next(iter(room.connections))
        await room.receive(conn, create_update_message(editor.set("shape", 1)))
        async with sessions() as session:
            await session.execute(delete(Board).where(Board.id == board_id))
            await session.commit()
        # Без discard закрытие комнаты попыталось бы записать изменение и упало бы
        # на внешнем ключе удалённой доски.
        rooms.discard(board_id)
    assert rooms.open_rooms() == 0


async def test_flush_writes_accepted_changes_at_once(
    sessions: Sessions, someone: uuid.UUID
) -> None:
    board_id = await new_board(sessions)
    # Без flush комната записала бы изменения только через минуту.
    rooms = RoomManager(sessions, replace(POLICY, delay=60))
    await rooms.flush(board_id)
    async with rooms.connect(board_id, Connection(Recorder().send, someone)) as room:
        conn = next(iter(room.connections))
        await room.receive(conn, create_update_message(Editor().set("shape", 1)))
        assert await stored_updates(sessions, board_id) == 0
        await rooms.flush(board_id)
        assert await stored_updates(sessions, board_id) == 1
        assert await restored(sessions, board_id) == {"shape": 1}


async def test_flush_waits_for_a_closing_room(
    sessions: Sessions, monkeypatch: pytest.MonkeyPatch, someone: uuid.UUID
) -> None:
    board_id = await new_board(sessions)
    rooms = RoomManager(sessions, replace(POLICY, delay=60))
    connection = rooms.connect(board_id, Connection(Recorder().send, someone))
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


# Интервал версий в тестах ниже — доли секунды.
OFTEN = replace(POLICY, version_interval=timedelta(seconds=0.05))
EMPTY_STATE = Doc().get_update()


async def test_versions_are_saved_while_the_board_changes_and_when_everyone_leaves(
    sessions: Sessions, someone: uuid.UUID
) -> None:
    board_id = await new_board(sessions)
    editor = Editor()
    rooms = RoomManager(sessions, OFTEN)
    async with rooms.connect(board_id, Connection(Recorder().send, someone)) as room:
        conn = next(iter(room.connections))
        await room.receive(conn, create_update_message(editor.set("a", 1)))
        await asyncio.sleep(0.2)
        assert await saved_versions(sessions, board_id) == [Saved(None, None, {someone}, {"a": 1})]
        # Пока доску не меняют, новых версий нет.
        await asyncio.sleep(0.2)
        assert len(await saved_versions(sessions, board_id)) == 1
        await room.receive(conn, create_update_message(editor.set("b", 2)))
    # Все ушли раньше срока: версия сохраняется при закрытии комнаты.
    versions = await saved_versions(sessions, board_id)
    assert [version.elements for version in versions] == [{"a": 1}, {"a": 1, "b": 2}]


async def test_a_session_without_changes_saves_no_version(
    sessions: Sessions, someone: uuid.UUID
) -> None:
    board_id = await new_board(sessions)
    await store_history(sessions, board_id, Editor(), 2)
    rooms = RoomManager(sessions, OFTEN)
    async with rooms.connect(board_id, Connection(Recorder().send, someone)):
        await asyncio.sleep(0.1)
    assert await saved_versions(sessions, board_id) == []


async def test_the_board_before_its_first_change_is_kept_when_no_version_has_it(
    sessions: Sessions, someone: uuid.UUID
) -> None:
    board_id = await new_board(sessions)
    editor = Editor()
    await store_history(sessions, board_id, editor, 2)
    rooms = RoomManager(sessions, POLICY)
    for value in (1, 2):
        async with rooms.connect(board_id, Connection(Recorder().send, someone)) as room:
            conn = next(iter(room.connections))
            await room.receive(conn, create_update_message(editor.set("extra", value)))
    before = {"shape-0": 0, "shape-1": 1}
    # Во второй раз доска такая, как в последней версии: сохранять её заново незачем.
    assert await saved_versions(sessions, board_id) == [
        Saved(None, None, set(), before),
        Saved(None, None, {someone}, {**before, "extra": 1}),
        Saved(None, None, {someone}, {**before, "extra": 2}),
    ]


async def test_a_named_version_takes_the_changes_made_so_far(
    sessions: Sessions, someone: uuid.UUID
) -> None:
    board_id = await new_board(sessions)
    editor, inbox = Editor(), Recorder()
    rooms = RoomManager(sessions, POLICY)
    async with rooms.connect(board_id, Connection(inbox.send, someone)) as room:
        conn = next(iter(room.connections))
        await room.receive(conn, create_update_message(editor.set("a", 1)))
        inbox.messages.clear()
        await rooms.save_version(board_id, "Перед ревью", someone)
        # Участники узнают, что список версий изменился.
        assert inbox.messages == [VERSIONS_CHANGED]
    # После названной версии доску не меняли: при закрытии новая версия не нужна.
    assert await saved_versions(sessions, board_id) == [
        Saved("Перед ревью", someone, {someone}, {"a": 1})
    ]


async def test_a_named_version_of_a_closed_board_is_read_from_the_database(
    sessions: Sessions, someone: uuid.UUID
) -> None:
    board_id = await new_board(sessions)
    await store_history(sessions, board_id, Editor(), 2)
    await RoomManager(sessions, POLICY).save_version(board_id, "Итог", someone)
    assert await saved_versions(sessions, board_id) == [
        Saved("Итог", someone, set(), {"shape-0": 0, "shape-1": 1})
    ]


async def test_a_named_version_waits_for_a_closing_room(
    sessions: Sessions, monkeypatch: pytest.MonkeyPatch, someone: uuid.UUID
) -> None:
    board_id = await new_board(sessions)
    rooms = RoomManager(sessions, replace(POLICY, delay=60))
    connection = rooms.connect(board_id, Connection(Recorder().send, someone))
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
    # Комната дописывает изменение и сохраняет его версией, а названная версия идёт следом.
    await rooms.save_version(board_id, "Итог", someone)
    versions = await saved_versions(sessions, board_id)
    assert [(version.name, version.elements) for version in versions] == [
        (None, {"a": 1}),
        ("Итог", {"a": 1}),
    ]
    await leaving


async def test_old_automatic_versions_are_deleted_and_named_ones_are_kept(
    sessions: Sessions, someone: uuid.UUID
) -> None:
    board_id, other_id = await new_board(sessions), await new_board(sessions)
    old = datetime.now(UTC) - POLICY.version_retention - timedelta(days=1)
    recent = datetime.now(UTC) - POLICY.version_retention + timedelta(days=1)
    async with sessions() as session:
        session.add_all(
            [
                BoardVersion(board_id=board_id, name="Релиз", state=EMPTY_STATE, created_at=old),
                BoardVersion(board_id=board_id, state=EMPTY_STATE, created_at=old),
                BoardVersion(board_id=board_id, state=EMPTY_STATE, created_at=recent),
                # Версии других досок удаляются, когда новые версии появляются у них самих.
                BoardVersion(board_id=other_id, state=EMPTY_STATE, created_at=old),
            ]
        )
        await session.commit()
    await RoomManager(sessions, POLICY).save_version(board_id, "Сейчас", someone)
    assert [version.name for version in await saved_versions(sessions, board_id)] == [
        "Релиз",
        None,
        "Сейчас",
    ]
    assert len(await saved_versions(sessions, other_id)) == 1


async def test_a_version_that_failed_to_save_is_saved_later(
    sessions: Sessions, monkeypatch: pytest.MonkeyPatch, someone: uuid.UUID
) -> None:
    board_id = await new_board(sessions)
    failures = 0

    async def flaky_save(*args: Any, **kwargs: Any) -> uuid.UUID:
        nonlocal failures
        if failures == 0:
            failures += 1
            raise ConnectionError("database is down")
        return await save_version(*args, **kwargs)

    monkeypatch.setattr(ROOM_SAVE_VERSION, flaky_save)
    rooms = RoomManager(sessions, OFTEN)
    async with rooms.connect(board_id, Connection(Recorder().send, someone)) as room:
        conn = next(iter(room.connections))
        await room.receive(conn, create_update_message(Editor().set("a", 1)))
        await asyncio.sleep(0.3)
        assert failures == 1
        assert await saved_versions(sessions, board_id) == [Saved(None, None, {someone}, {"a": 1})]


async def test_changes_of_a_named_version_that_failed_go_into_the_next_one(
    sessions: Sessions, monkeypatch: pytest.MonkeyPatch, someone: uuid.UUID
) -> None:
    board_id = await new_board(sessions)
    rooms = RoomManager(sessions, POLICY)
    async with rooms.connect(board_id, Connection(Recorder().send, someone)) as room:
        conn = next(iter(room.connections))
        await room.receive(conn, create_update_message(Editor().set("a", 1)))
        with monkeypatch.context() as patch:
            patch.setattr(ROOM_SAVE_VERSION, broken_save)
            with pytest.raises(ConnectionError):
                await rooms.save_version(board_id, "Не вышло", someone)
    assert await saved_versions(sessions, board_id) == [Saved(None, None, {someone}, {"a": 1})]


async def broken_save(*_args: Any, **_kwargs: Any) -> uuid.UUID:
    raise ConnectionError("database is down")
