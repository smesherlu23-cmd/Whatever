import uuid

from fastapi import APIRouter, WebSocket

from app.auth.dependencies import is_same_origin
from app.auth.sessions import COOKIE_NAME, user_for_token
from app.db import session_factory
from app.models import Board
from app.sync.room import Connection, RoomManager
from app.sync.sockets import (
    BOARD_NOT_FOUND,
    FOREIGN_ORIGIN,
    NOT_AUTHENTICATED,
    SessionSockets,
)

router = APIRouter()


class _RejectedError(Exception):
    def __init__(self, code: int) -> None:
        super().__init__(code)
        self.code = code


async def _authenticate(websocket: WebSocket, board_id: uuid.UUID) -> tuple[uuid.UUID, str]:
    """Пользователь и токен его сессии. Если подключение принять нельзя, бросает _RejectedError."""
    if not is_same_origin(websocket):
        raise _RejectedError(FOREIGN_ORIGIN)
    token = websocket.cookies.get(COOKIE_NAME)
    async with session_factory()() as session:
        user = await user_for_token(session, token) if token else None
        if token is None or user is None:
            raise _RejectedError(NOT_AUTHENTICATED)
        if await session.get(Board, board_id) is None:
            raise _RejectedError(BOARD_NOT_FOUND)
        return user.id, token


@router.websocket("/ws/boards/{board_id}")
async def board_socket(websocket: WebSocket, board_id: uuid.UUID) -> None:
    rooms: RoomManager = websocket.app.state.rooms
    sockets: SessionSockets = websocket.app.state.sockets
    try:
        user_id, token = await _authenticate(websocket, board_id)
    except _RejectedError as rejected:
        # Свой код закрытия браузер получит, только если соединение сначала принять.
        await websocket.accept()
        await websocket.close(code=rejected.code)
        return

    await websocket.accept()
    conn = Connection(websocket.send_bytes)
    with sockets.track(websocket, user_id, token):
        async with rooms.connect(board_id, conn) as room:
            # iter_bytes заканчивается, когда клиент отключился или сервер закрыл соединение.
            async for message in websocket.iter_bytes():
                await room.receive(conn, message)
