"""WebSocket синхронизации доски: проверка входа и прав, затем подключение к комнате."""

import asyncio
import uuid
from dataclasses import dataclass

from fastapi import APIRouter, WebSocket

from app.access import Access, access_to
from app.auth.dependencies import is_same_origin
from app.auth.sessions import COOKIE_NAME, user_for_token
from app.core.config import Settings
from app.core.db import Database
from app.core.metrics import Metrics
from app.models import Board
from app.sync.outbox import Outbox
from app.sync.room import Connection, RoomManager
from app.sync.sockets import (
    BOARD_NOT_FOUND,
    FORBIDDEN,
    NOT_AUTHENTICATED,
    SLOW_CLIENT,
    BoardSockets,
)

router = APIRouter()

# Насколько клиент может отстать, прежде чем его отключат. Снимок большой доски при
# подключении весит сотни килобайт, а поток правок нескольких участников — десятки килобайт
# в секунду: запаса хватает на десятки секунд плохой связи.
OUTBOX_LIMIT_BYTES = 8 * 1024 * 1024


class _RejectedError(Exception):
    def __init__(self, code: int) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class _Admitted:
    user_id: uuid.UUID
    token: str
    can_edit: bool


async def _admit(websocket: WebSocket, board_id: uuid.UUID) -> _Admitted:
    """Кто подключается и может ли он править доску. Если пускать нельзя, бросает _RejectedError."""
    if not is_same_origin(websocket):
        raise _RejectedError(FORBIDDEN)
    token = websocket.cookies.get(COOKIE_NAME)
    if token is None:
        raise _RejectedError(NOT_AUTHENTICATED)
    database: Database = websocket.app.state.database
    settings: Settings = websocket.app.state.settings
    # Сессия базы нужна только на время проверки: подключение к доске живёт часами.
    async with database.sessions() as session:
        user = await user_for_token(session, token, settings.session_ttl)
        if user is None:
            raise _RejectedError(NOT_AUTHENTICATED)
        board = await session.get(Board, board_id)
        if board is None:
            raise _RejectedError(BOARD_NOT_FOUND)
        access = await access_to(session, board, user)
        if access is None:
            raise _RejectedError(FORBIDDEN)
        return _Admitted(user.id, token, can_edit=access.allows(Access.EDIT))


@router.websocket("/ws/boards/{board_id}")
async def board_socket(websocket: WebSocket, board_id: uuid.UUID) -> None:
    rooms: RoomManager = websocket.app.state.rooms
    sockets: BoardSockets = websocket.app.state.sockets
    metrics: Metrics = websocket.app.state.metrics
    try:
        admitted = await _admit(websocket, board_id)
    except _RejectedError as rejected:
        # Свой код закрытия браузер получит, только если соединение сначала принять.
        await websocket.accept()
        await websocket.close(code=rejected.code)
        return

    await websocket.accept()
    closing: set[asyncio.Task[None]] = set()

    def disconnect_slow_client() -> None:
        metrics.slow_clients.inc()
        # Закрытие идёт своей задачей: оно тоже может ждать медленного клиента.
        task = asyncio.create_task(websocket.close(code=SLOW_CLIENT))
        closing.add(task)
        task.add_done_callback(closing.discard)

    outbox = Outbox(
        websocket.send_bytes, limit=OUTBOX_LIMIT_BYTES, on_overflow=disconnect_slow_client
    )
    conn = Connection(outbox.send, admitted.user_id, can_edit=admitted.can_edit)
    with sockets.track(
        websocket, user_id=admitted.user_id, token=admitted.token, board_id=board_id
    ):
        async with outbox.running(), rooms.connect(board_id, conn) as room:
            # iter_bytes заканчивается, когда клиент отключился или сервер закрыл соединение.
            async for message in websocket.iter_bytes():
                await room.receive(conn, message)
    await asyncio.gather(*closing, return_exceptions=True)
