"""Открытые WebSocket-подключения досок и сессии, по которым они приняты."""

import asyncio
import logging
import uuid
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass

from starlette.websockets import WebSocket

from app.auth.sessions import token_hash

log = logging.getLogger(__name__)

# Коды закрытия WebSocket (диапазон 4000–4999 отведён приложениям). Клиент y-websocket
# не переподключается при кодах 4400–4499: повторная попытка тут ничего не изменит.
NOT_AUTHENTICATED = 4401
FOREIGN_ORIGIN = 4403
BOARD_NOT_FOUND = 4404


@dataclass(frozen=True)
class _Owner:
    user_id: uuid.UUID
    token_hash: str


class SessionSockets:
    """Сессия проверяется один раз, при подключении к доске.

    Чтобы выход, блокировка и смена пароля действовали сразу, а не после переподключения,
    их обработчики закрывают подключения завершённых сессий через этот реестр.
    Реестр живёт в памяти процесса, как и комнаты досок.
    """

    def __init__(self) -> None:
        self._open: dict[WebSocket, _Owner] = {}

    @contextmanager
    def track(self, websocket: WebSocket, user_id: uuid.UUID, token: str) -> Iterator[None]:
        self._open[websocket] = _Owner(user_id, token_hash(token))
        try:
            yield
        finally:
            del self._open[websocket]

    async def close_session(self, token: str) -> None:
        hashed = token_hash(token)
        await self._close(ws for ws, owner in self._open.items() if owner.token_hash == hashed)

    async def close_user(self, user_id: uuid.UUID, *, keep_token: str | None = None) -> None:
        """Закрывает подключения пользователя, кроме принятых по сессии keep_token."""
        kept = token_hash(keep_token) if keep_token else None
        await self._close(
            ws
            for ws, owner in self._open.items()
            if owner.user_id == user_id and owner.token_hash != kept
        )

    async def _close(self, sockets: Iterable[WebSocket]) -> None:
        targets = list(sockets)
        results = await asyncio.gather(
            *(ws.close(code=NOT_AUTHENTICATED) for ws in targets), return_exceptions=True
        )
        for result in results:
            if isinstance(result, Exception):
                # Клиент успел отключиться сам: закрывать уже нечего.
                log.debug("closing a socket failed: %s", result)
