"""Открытые WebSocket-подключения досок: чьи они, по какой сессии и к какой доске."""

import asyncio
import logging
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass

from starlette.websockets import WebSocket

from app.auth.sessions import token_hash

log = logging.getLogger(__name__)

# Коды закрытия WebSocket (диапазон 4000–4999 отведён приложениям). Клиент y-websocket
# не переподключается при кодах 4400–4499: повторная попытка тут ничего не изменит.
NOT_AUTHENTICATED = 4401
# Подключение с чужого сайта или к доске, доступа к которой нет.
FORBIDDEN = 4403
BOARD_NOT_FOUND = 4404
# Права на доску изменились. Клиент переподключится, и сервер проверит их заново.
ACCESS_CHANGED = 4100


@dataclass(frozen=True)
class _Owner:
    user_id: uuid.UUID
    token_hash: str
    board_id: uuid.UUID


class BoardSockets:
    """Вход и права проверяются один раз, при подключении к доске.

    Чтобы выход, блокировка, смена пароля и прав действовали сразу, а не после
    переподключения, их обработчики закрывают затронутые подключения через этот реестр.
    Реестр живёт в памяти процесса, как и комнаты досок.
    """

    def __init__(self) -> None:
        self._open: dict[WebSocket, _Owner] = {}

    @contextmanager
    def track(
        self, websocket: WebSocket, *, user_id: uuid.UUID, token: str, board_id: uuid.UUID
    ) -> Iterator[None]:
        self._open[websocket] = _Owner(user_id, token_hash(token), board_id)
        try:
            yield
        finally:
            del self._open[websocket]

    async def close_session(self, token: str) -> None:
        """После выхода: доски, открытые по этой сессии, отключаются."""
        hashed = token_hash(token)
        await self._close(NOT_AUTHENTICATED, lambda owner: owner.token_hash == hashed)

    async def close_user(self, user_id: uuid.UUID, *, keep_token: str | None = None) -> None:
        """После блокировки или смены пароля: закрывает подключения, кроме сессии keep_token."""
        kept = token_hash(keep_token) if keep_token else None
        await self._close(
            NOT_AUTHENTICATED,
            lambda owner: owner.user_id == user_id and owner.token_hash != kept,
        )

    async def recheck_user(self, user_id: uuid.UUID) -> None:
        """После смены роли: права на все открытые доски пользователя проверятся заново."""
        await self._close(ACCESS_CHANGED, lambda owner: owner.user_id == user_id)

    async def recheck_member(self, board_id: uuid.UUID, user_id: uuid.UUID) -> None:
        """После выдачи или отзыва доступа к доске."""
        await self._close(
            ACCESS_CHANGED, lambda owner: owner.board_id == board_id and owner.user_id == user_id
        )

    async def close_board(self, board_id: uuid.UUID) -> None:
        """После удаления доски."""
        await self._close(BOARD_NOT_FOUND, lambda owner: owner.board_id == board_id)

    async def _close(self, code: int, matches: Callable[[_Owner], bool]) -> None:
        targets = [ws for ws, owner in self._open.items() if matches(owner)]
        results = await asyncio.gather(
            *(ws.close(code=code) for ws in targets), return_exceptions=True
        )
        for result in results:
            if isinstance(result, Exception):
                # Клиент успел отключиться сам: закрывать уже нечего.
                log.debug("closing a socket failed: %s", result)
