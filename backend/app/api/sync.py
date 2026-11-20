import uuid

from fastapi import APIRouter, WebSocket

from app.db import session_factory
from app.models import Board
from app.sync.room import Connection, RoomManager

router = APIRouter()

# Код закрытия WebSocket «доска не найдена» (диапазон 4000–4999 отведён приложениям).
BOARD_NOT_FOUND = 4404


@router.websocket("/ws/boards/{board_id}")
async def board_socket(websocket: WebSocket, board_id: uuid.UUID) -> None:
    rooms: RoomManager = websocket.app.state.rooms
    async with session_factory()() as session:
        exists = await session.get(Board, board_id) is not None
    await websocket.accept()
    if not exists:
        await websocket.close(code=BOARD_NOT_FOUND)
        return

    conn = Connection(websocket.send_bytes)
    async with rooms.connect(board_id, conn) as room:
        # iter_bytes заканчивается, когда клиент отключился.
        async for message in websocket.iter_bytes():
            await room.receive(conn, message)
