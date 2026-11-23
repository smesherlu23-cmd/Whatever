"""Комнаты синхронизации досок по протоколу Yjs (совместим с клиентом y-websocket).

Каждая открытая доска — комната с документом pycrdt в памяти. Клиент и сервер обмениваются
сообщениями синхронизации (SYNC) и присутствия (AWARENESS). Изменения документа сразу
рассылаются остальным участникам, а в PostgreSQL пишутся пачками (см. Room.save).
Изменения от подключений без права редактирования отбрасываются (см. Room._receive_sync).
Комната же сохраняет версии доски (см. Room._accept): она знает, кто и когда менял доску.
"""

import asyncio
import logging
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable, Coroutine
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import partial
from typing import Any

from pycrdt import (
    Awareness,
    Doc,
    YMessageType,
    YSyncMessageType,
    create_awareness_message,
    create_sync_message,
    create_update_message,
    handle_sync_message,
    merge_updates,
    read_message,
)
from sqlalchemy import Select, delete, func, select, update

from app.board_content import read_state
from app.core.db import Sessions
from app.models import Board, BoardUpdate, BoardVersion
from app.sync.limits import AWARENESS_BURST, AWARENESS_MAX_BYTES, AWARENESS_PER_SECOND, RateLimit
from app.versions import save_version

log = logging.getLogger(__name__)

# Тип сообщения y-websocket «запросить присутствие всех участников».
QUERY_AWARENESS = 3

# Сообщения приложения поверх протокола y-websocket: «обсуждения доски изменились, перечитайте
# их» и то же о версиях. Номера взяты с запасом, чтобы не совпасть с типами самого протокола.
# Клиент обрабатывает их своими обработчиками сообщений провайдера (src/collab/session.ts).
COMMENTS_CHANGED = bytes([100])
VERSIONS_CHANGED = bytes([101])

Send = Callable[[bytes], Awaitable[None]]


@dataclass(frozen=True)
class SavePolicy:
    """Как комната пишет доску в базу.

    Изменения за delay секунд пишутся одной строкой: перетаскивание фигуры даёт десятки
    изменений в секунду, и писать каждое по отдельности было бы расточительно. Когда записей
    истории больше compact_after, они сжимаются в один снимок: и в открытой комнате (доска
    может быть открыта весь день), и при её закрытии.

    Версия доски сохраняется через version_interval после первого изменения, которого нет
    в прошлой версии, и при закрытии комнаты, если с тех пор доску меняли. Автоматические
    версии старше version_retention удаляются (см. app.versions).
    """

    delay: float
    compact_after: int
    version_interval: timedelta
    version_retention: timedelta


class Connection:
    """Одно подключение к комнате: чьё оно и может ли менять доску. Помнит id клиентов Yjs,
    чьё присутствие оно передавало.

    can_edit задаётся при подключении. Когда права меняются, подключение закрывают,
    и клиент подключается заново уже с новыми правами (см. BoardSockets).
    """

    def __init__(self, send: Send, user_id: uuid.UUID, *, can_edit: bool = True) -> None:
        self.send = send
        self.user_id = user_id
        self.can_edit = can_edit
        self.client_ids: set[int] = set()
        self.awareness_limit = RateLimit(AWARENESS_PER_SECOND, AWARENESS_BURST)


@dataclass(frozen=True)
class _PendingVersion:
    """Содержимое доски для версии и кто менял доску после прошлой версии."""

    state: bytes
    editors: frozenset[uuid.UUID]
    # Есть ли в версии изменения, которых нет в прошлой.
    changed: bool


class Room:
    """Документ одной доски в памяти и её участники.

    Принятые изменения пишутся в базу с задержкой SavePolicy.delay. Если сервер упадёт
    в этот промежуток, изменения не потеряются: у клиентов есть локальная копия,
    и при переподключении протокол Yjs досылает серверу всё, чего у него нет.
    """

    def __init__(self, board_id: uuid.UUID, sessions: Sessions, policy: SavePolicy) -> None:
        self.board_id = board_id
        self.sessions = sessions
        self.policy = policy
        self.doc: Doc[Any] = Doc()
        self.awareness = Awareness(self.doc)
        self.connections: set[Connection] = set()
        self.loaded = False
        self._received: list[bytes] = []
        self._unsaved: list[bytes] = []
        # Сколько строк истории доски в базе: по нему комната решает, когда сжимать.
        self._stored = 0
        self._save_timer: asyncio.TimerHandle | None = None
        # Записи в базу, которые идут сейчас: закрытие комнаты их дожидается.
        self._writes: set[asyncio.Task[None]] = set()
        self._save_lock = asyncio.Lock()
        self._closed = False
        self._discarded = False
        # Кто менял доску после прошлой версии и есть ли изменения, которых в ней нет.
        self._editors: set[uuid.UUID] = set()
        self._unversioned = False
        self._version_timer: asyncio.TimerHandle | None = None
        # Того, что на доске сейчас, нет ни в одной версии: перед первой правкой его сохраняют.
        self._baseline_needed = False
        self.doc.observe(lambda event: self._received.append(event.update))
        self.awareness.observe(self._on_awareness)

    # ---------- Загрузка и сохранение ----------

    async def load(self) -> None:
        async with self.sessions() as session:
            # История склеивается в отдельном потоке: после сбоя её может быть много.
            state = await read_state(session, self.board_id)
            self._stored = await session.scalar(self._count_stored()) or 0
            last_change = await session.scalar(
                select(func.max(BoardUpdate.created_at)).where(
                    BoardUpdate.board_id == self.board_id
                )
            )
            last_version = await session.scalar(
                select(func.max(BoardVersion.created_at)).where(
                    BoardVersion.board_id == self.board_id
                )
            )
        self.doc.apply_update(state)
        self._received.clear()
        # Содержимое записано позже последней версии: доску создали по шаблону, её версии
        # удалены по сроку или прошлый сеанс не успел сохранить версию.
        self._baseline_needed = last_change is not None and (
            last_version is None or last_version < last_change
        )
        self.loaded = True

    async def save(self) -> None:
        """Записывает накопленные изменения одной строкой."""
        async with self._save_lock:
            if not self._unsaved:
                return
            updates, self._unsaved = self._unsaved, []
            try:
                await self._persist(merge_updates(*updates))
            except BaseException:
                # Вернуть изменения в очередь, чтобы следующая попытка их записала.
                self._unsaved[:0] = updates
                raise
            self._stored += 1
            if self._stored > self.policy.compact_after and not self._closed:
                try:
                    await self._compact()
                except Exception:
                    # Изменения уже записаны; сжатие повторится после следующей записи.
                    log.warning("board %s: compaction failed", self.board_id, exc_info=True)

    async def _persist(self, data: bytes) -> None:
        async with self.sessions() as session:
            session.add(BoardUpdate(board_id=self.board_id, data=data))
            await session.execute(
                update(Board).where(Board.id == self.board_id).values(updated_at=datetime.now(UTC))
            )
            await session.commit()

    def _schedule_save(self) -> None:
        if self._closed or self._save_timer is not None:
            return
        loop = asyncio.get_running_loop()
        self._save_timer = loop.call_later(self.policy.delay, self._start_save)

    def _start_save(self) -> None:
        self._save_timer = None
        self._write_soon(self._save_or_retry())

    def _write_soon(self, write: Coroutine[Any, Any, None]) -> None:
        task = asyncio.create_task(write)
        self._writes.add(task)
        task.add_done_callback(self._writes.discard)

    async def _save_or_retry(self) -> None:
        try:
            await self.save()
        except Exception:
            log.warning("board %s: saving failed, will retry", self.board_id, exc_info=True)
            self._schedule_save()

    def _stop_saving(self) -> None:
        self._closed = True
        if self._save_timer is not None:
            self._save_timer.cancel()
            self._save_timer = None
        self._cancel_version_timer()

    def discard(self) -> None:
        """Доску удалили: всё несохранённое отбрасывается, писать его уже некуда."""
        self._stop_saving()
        self._discarded = True
        self._unsaved.clear()

    async def close(self) -> None:
        """Записывает всё несохранённое, сжимает историю доски и сохраняет её версию."""
        self._stop_saving()
        await asyncio.gather(*self._writes, return_exceptions=True)
        if not self.loaded or self._discarded:
            # Документ не загрузился: сохранять и сжимать нечего, а сжатие стёрло бы историю.
            return
        await self.save()
        await self.compact()
        if self._unversioned:
            await self._save_auto_version(self._take_version())

    async def compact(self) -> None:
        """Заменяет накопленные дельты одним снимком, чтобы доска открывалась быстрее."""
        async with self._save_lock:
            await self._compact()

    def _count_stored(self) -> Select[int]:
        return select(func.count()).where(BoardUpdate.board_id == self.board_id)

    async def _compact(self) -> None:
        # Вызывается под _save_lock: пока идёт сжатие, комната ничего не дописывает. Снимок
        # берётся из документа в памяти, а в нём есть всё записанное (и ещё не записанное).
        async with self.sessions() as session:
            count = await session.scalar(self._count_stored())
            if not count or count <= self.policy.compact_after:
                self._stored = count or 0
                return
            # Снимок помечается временем последнего изменения, а не сжатия: по этому времени
            # загрузка решает, есть ли на доске то, чего нет ни в одной версии.
            last_change = await session.scalar(
                select(func.max(BoardUpdate.created_at)).where(
                    BoardUpdate.board_id == self.board_id
                )
            )
            await session.execute(delete(BoardUpdate).where(BoardUpdate.board_id == self.board_id))
            session.add(
                BoardUpdate(
                    board_id=self.board_id, data=self.doc.get_update(), created_at=last_change
                )
            )
            await session.commit()
        self._stored = 1
        log.info("board %s compacted from %d updates", self.board_id, count)

    # ---------- Версии ----------

    async def save_version(self, name: str, saved_by: uuid.UUID) -> uuid.UUID:
        """Сохраняет названную версию с тем, что сейчас на доске, и возвращает её id."""
        pending = self._take_version()
        try:
            return await self._write_version(pending, name=name, saved_by=saved_by)
        except BaseException:
            self._give_back(pending)
            raise

    def _take_version(self) -> _PendingVersion:
        """Забирает для версии всё, что сейчас на доске. Следующие правки войдут уже
        в следующую версию. Без await: правки других подключений сюда не вклинятся."""
        pending = _PendingVersion(
            self.doc.get_update(), frozenset(self._editors), changed=self._unversioned
        )
        self._editors = set()
        self._unversioned = False
        self._baseline_needed = False
        self._cancel_version_timer()
        return pending

    def _give_back(self, pending: _PendingVersion) -> None:
        """Версию записать не удалось: её изменения войдут в следующую."""
        self._editors |= pending.editors
        if pending.changed:
            self._mark_unversioned()

    def _mark_unversioned(self) -> None:
        if self._unversioned:
            return
        self._unversioned = True
        if not self._closed:
            loop = asyncio.get_running_loop()
            self._version_timer = loop.call_later(
                self.policy.version_interval.total_seconds(), self._version_due
            )

    def _cancel_version_timer(self) -> None:
        if self._version_timer is not None:
            self._version_timer.cancel()
            self._version_timer = None

    def _version_due(self) -> None:
        self._version_timer = None
        self._write_soon(self._save_auto_version(self._take_version()))

    async def _save_auto_version(self, pending: _PendingVersion) -> None:
        """Записывает автоматическую версию. Сбой не страшен: правки уже в базе, а в версию
        они войдут в следующий раз."""
        try:
            await self._write_version(pending)
        except Exception:
            log.warning("board %s: saving a version failed", self.board_id, exc_info=True)
            self._give_back(pending)

    async def _write_version(
        self,
        pending: _PendingVersion,
        *,
        name: str | None = None,
        saved_by: uuid.UUID | None = None,
    ) -> uuid.UUID:
        async with self.sessions() as session:
            version_id = await save_version(
                session,
                self.board_id,
                pending.state,
                editors=pending.editors,
                retention=self.policy.version_retention,
                name=name,
                saved_by=saved_by,
            )
        await self.broadcast(VERSIONS_CHANGED)
        return version_id

    # ---------- Участники ----------

    async def greet(self, conn: Connection) -> None:
        """Отправляет новому участнику состояние документа и присутствие остальных."""
        # Сервер первым отправляет своё состояние, клиент отвечает недостающими изменениями.
        await conn.send(create_sync_message(self.doc))
        await self._send_awareness(conn)

    async def leave(self, conn: Connection) -> None:
        self.connections.discard(conn)
        ids = [i for i in conn.client_ids if i in self.awareness.states]
        if ids:
            self.awareness.remove_awareness_states(ids, conn)
            message = create_awareness_message(self.awareness.encode_awareness_update(ids))
            await self.broadcast(message, exclude=conn)

    def _on_awareness(self, topic: str, payload: tuple[dict[str, Any], Any]) -> None:
        changes, origin = payload
        if isinstance(origin, Connection) and topic == "change":
            origin.client_ids.update(changes.get("added", []))
            for client_id in changes.get("removed", []):
                origin.client_ids.discard(client_id)

    # ---------- Сообщения ----------

    async def receive(self, conn: Connection, message: bytes) -> None:
        if not message:
            return
        kind = message[0]
        if kind == YMessageType.SYNC:
            await self._receive_sync(conn, message)
        elif kind == YMessageType.AWARENESS:
            await self._receive_awareness(conn, message)
        elif kind == QUERY_AWARENESS:
            await self._send_awareness(conn)

    async def _receive_awareness(self, conn: Connection, message: bytes) -> None:
        # Присутствие обновляется постоянно, так что пропущенное сообщение заменит следующее,
        # а клиент к тому же повторяет своё состояние каждые 15 секунд.
        if len(message) > AWARENESS_MAX_BYTES or not conn.awareness_limit.allow():
            log.debug("board %s: dropped an oversized or too frequent presence", self.board_id)
            return
        self.awareness.apply_awareness_update(read_message(message[1:]), conn)
        await self.broadcast(message, exclude=conn)

    async def _receive_sync(self, conn: Connection, message: bytes) -> None:
        # Шаг 1 — только запрос недостающего, а шаг 2 и обновления меняют документ.
        changes = message[1:2] != bytes([YSyncMessageType.SYNC_STEP1])
        if changes and not conn.can_edit:
            # Зрителю отвечают на запрос, но его изменения не применяются и не рассылаются.
            log.debug("board %s: dropped a change from a read-only connection", self.board_id)
            return
        before = self.doc.get_update() if changes and self._baseline_needed else None
        # Между применением сообщения и учётом изменений нет await,
        # поэтому изменения из других подключений сюда не попадут.
        reply = handle_sync_message(message[1:], self.doc)
        updates, self._received = self._received, []
        if updates:
            self._accept(conn, updates, before)
        if reply is not None:
            await conn.send(reply)
        for u in updates:
            await self.broadcast(create_update_message(u), exclude=conn)

    def _accept(self, conn: Connection, updates: list[bytes], before: bytes | None) -> None:
        """Учитывает принятые изменения: их запись в базу и версию, в которую они войдут.

        before — содержимое доски до них, если его нет ни в одной версии: тогда оно
        сохраняется версией, чтобы к нему можно было вернуться.
        """
        if before is not None:
            self._baseline_needed = False
            baseline = _PendingVersion(before, frozenset(), changed=False)
            self._write_soon(self._save_auto_version(baseline))
        self._unsaved.extend(updates)
        self._schedule_save()
        self._editors.add(conn.user_id)
        self._mark_unversioned()

    async def _send_awareness(self, conn: Connection) -> None:
        states = list(self.awareness.states)
        if states:
            await conn.send(
                create_awareness_message(self.awareness.encode_awareness_update(states))
            )

    async def broadcast(self, message: bytes, exclude: Connection | None = None) -> None:
        """Отправляет сообщение участникам. Отключившиеся по пути не мешают остальным."""
        targets = [c for c in self.connections if c is not exclude]
        results = await asyncio.gather(*(c.send(message) for c in targets), return_exceptions=True)
        for result in results:
            if isinstance(result, Exception):
                log.debug("broadcast failed: %s", result)


@dataclass(eq=False)
class _OpenRoom:
    room: Room
    loading: asyncio.Task[None]


class RoomManager:
    """Держит открытые комнаты. Комната создаётся при первом подключении и закрывается
    после ухода последнего участника.

    Общая блокировка защищает только словарь комнат и списки участников. Загрузка доски
    из базы и отправка данных клиентам идут вне её, поэтому медленная доска или медленный
    клиент не задерживают подключение к другим доскам.
    """

    def __init__(self, sessions: Sessions, policy: SavePolicy) -> None:
        self._sessions = sessions
        self._policy = policy
        self._rooms: dict[uuid.UUID, _OpenRoom] = {}
        self._closing: dict[uuid.UUID, asyncio.Task[None]] = {}
        self._lock = asyncio.Lock()

    @asynccontextmanager
    async def connect(self, board_id: uuid.UUID, conn: Connection) -> AsyncIterator[Room]:
        """Подключает участника к комнате доски на время блока with."""
        room = await self._join(board_id, conn)
        try:
            yield room
        finally:
            await self._leave(room, conn)

    async def _join(self, board_id: uuid.UUID, conn: Connection) -> Room:
        async with self._lock:
            entry = self._rooms.get(board_id)
            if entry is None:
                room = Room(board_id, self._sessions, self._policy)
                entry = _OpenRoom(room, asyncio.create_task(self._load(room)))
                self._rooms[board_id] = entry
            entry.room.connections.add(conn)
        try:
            await asyncio.shield(entry.loading)
            await entry.room.greet(conn)
        except BaseException:
            await self._leave(entry.room, conn)
            raise
        return entry.room

    async def _load(self, room: Room) -> None:
        # Если прошлая сессия этой доски ещё дописывает изменения, дождаться её.
        previous = self._closing.get(room.board_id)
        if previous is not None:
            await asyncio.gather(previous, return_exceptions=True)
        await room.load()

    async def _leave(self, room: Room, conn: Connection) -> None:
        await room.leave(conn)
        closing: asyncio.Task[None] | None = None
        async with self._lock:
            entry = self._rooms.get(room.board_id)
            if not room.connections and entry is not None and entry.room is room:
                del self._rooms[room.board_id]
                closing = asyncio.create_task(room.close())
                self._closing[room.board_id] = closing
                closing.add_done_callback(partial(self._forget_closing, room.board_id))
        if closing is not None:
            # Запись защищена от отмены: уже принятые изменения сохранятся,
            # даже если обработчик подключения прервали.
            await asyncio.shield(closing)

    async def flush(self, board_id: uuid.UUID) -> None:
        """Дописывает в базу изменения доски, принятые, но ещё не записанные.

        После этого база содержит всё, что видят участники: так копия доски (шаблон
        или доска из шаблона) не теряет правки последних долей секунды.
        """
        closing = self._closing.get(board_id)
        if closing is not None:
            await asyncio.gather(asyncio.shield(closing), return_exceptions=True)
        entry = self._rooms.get(board_id)
        if entry is not None and entry.room.loaded:
            await entry.room.save()

    async def save_version(self, board_id: uuid.UUID, name: str, saved_by: uuid.UUID) -> uuid.UUID:
        """Сохраняет названную версию с тем, что сейчас на доске, и возвращает её id.

        Если доска открыта, версия берётся из комнаты: там есть правки, которые ещё не записаны,
        и там знают, кто менял доску после прошлой версии. Иначе — из базы.
        """
        closing = self._closing.get(board_id)
        if closing is not None:
            await asyncio.gather(asyncio.shield(closing), return_exceptions=True)
        entry = self._rooms.get(board_id)
        if entry is not None and entry.room.loaded:
            return await entry.room.save_version(name, saved_by)
        async with self._sessions() as session:
            state = await read_state(session, board_id)
            return await save_version(
                session,
                board_id,
                state,
                editors=(),
                retention=self._policy.version_retention,
                name=name,
                saved_by=saved_by,
            )

    async def broadcast(self, board_id: uuid.UUID, message: bytes) -> None:
        """Отправляет сообщение всем, у кого открыта доска. Если её никто не открыл, ничего
        не делает: открывший позже получит всё актуальное при подключении."""
        entry = self._rooms.get(board_id)
        if entry is not None:
            await entry.room.broadcast(message)

    def discard(self, board_id: uuid.UUID) -> None:
        """Доску удалили: её открытая комната больше ничего не запишет."""
        entry = self._rooms.get(board_id)
        if entry is not None:
            entry.room.discard()

    def _forget_closing(self, board_id: uuid.UUID, task: asyncio.Task[None]) -> None:
        if self._closing.get(board_id) is task:
            del self._closing[board_id]

    async def shutdown(self) -> None:
        """При остановке сервера дожидается записи всех принятых изменений."""
        async with self._lock:
            rooms = [entry.room for entry in self._rooms.values()]
            self._rooms.clear()
        await asyncio.gather(
            *(room.close() for room in rooms),
            *self._closing.values(),
            return_exceptions=True,
        )

    def open_rooms(self) -> int:
        return len(self._rooms)
