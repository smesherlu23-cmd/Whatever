import uuid

from fastapi import APIRouter, WebSocket

from app.auth.dependencies import is_same_origin
from app.auth.sessions import COOKIE_NAME, user_for_token
from app.db import session_factory
from app.models import Board
from app.sync.room import Connection, RoomManager

router = APIRouter()

# Коды закрытия WebSocket (диапазон 4000–4999 отведён приложениям). Клиент y-websocket
# не переподключается при кодах 4400–4499: повторная попытка тут ничего не изменит.
NOT_AUTHENTICATED = 4401
FOREIGN_ORIGIN = 4403
BOARD_NOT_FOUND = 4404


async def _close_code(websocket: WebSocket, board_id: uuid.UUID) -> int | None:
    """Почему подключение нельзя принять, или None, если можно."""
    if not is_same_origin(websocket):
        return FOREIGN_ORIGIN
    token = websocket.cookies.get(COOKIE_NAME)
    async with session_factory()() as session:
        if token is None or await user_for_token(session, token) is None:
            return NOT_AUTHENTICATED
        if await session.get(Board, board_id) is None:
            return BOARD_NOT_FOUND
    return None


@router.websocket("/ws/boards/{board_id}")
async def board_socket(websocket: WebSocket, board_id: uuid.UUID) -> None:
    rooms: RoomManager = websocket.app.state.rooms
    reject = await _close_code(websocket, board_id)
    # Свой код закрытия браузер получит, только если соединение сначала принять.
    await websocket.accept()
    if reject is not None:
        await websocket.close(code=reject)
        return

    conn = Connection(websocket.send_bytes)
    async with rooms.connect(board_id, conn) as room:
        # iter_bytes заканчивается, когда клиент отключился.
        async for message in websocket.iter_bytes():
            await room.receive(conn, message)
