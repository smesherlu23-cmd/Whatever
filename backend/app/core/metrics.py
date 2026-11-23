"""Показатели работы для Prometheus и id запроса в журнале.

Показатели отдаёт /api/metrics, если задан WHATEVER_METRICS_TOKEN (см. app.api.metrics).
У каждого экземпляра приложения свой реестр: тесты создают приложения десятками, и общий
реестр модуля prometheus_client запутал бы их показатели.

Каждый HTTP-запрос и подключение WebSocket получает id: из заголовка X-Request-ID, который
ставит nginx, или новый. Он попадает во все записи журнала, сделанные во время запроса,
и возвращается клиенту в том же заголовке, так что жалобу пользователя можно найти в журнале.
"""

import re
import time
import uuid
from collections.abc import Callable
from contextvars import ContextVar

from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)
from prometheus_client.gc_collector import GCCollector
from prometheus_client.platform_collector import PlatformCollector
from prometheus_client.process_collector import ProcessCollector
from starlette.datastructures import MutableHeaders
from starlette.routing import BaseRoute
from starlette.types import ASGIApp, Message, Receive, Scope, Send

request_id: ContextVar[str | None] = ContextVar("request_id", default=None)

# id от nginx или клиента принимается, только если он похож на id: иначе в журнал попало бы
# что угодно.
_VALID_REQUEST_ID = re.compile(r"[A-Za-z0-9._-]{1,64}")


class Metrics:
    """Показатели приложения в собственном реестре."""

    def __init__(self) -> None:
        self.registry = CollectorRegistry()
        ProcessCollector(registry=self.registry)
        PlatformCollector(registry=self.registry)
        GCCollector(registry=self.registry)
        self.requests = Histogram(
            "whatever_http_request_duration_seconds",
            "Время ответа на HTTP-запрос",
            ["method", "route", "status"],
            registry=self.registry,
        )
        self.board_saves = Counter(
            "whatever_board_saves",
            "Записи изменений досок в базу",
            ["result"],
            registry=self.registry,
        )
        self.board_save_seconds = Histogram(
            "whatever_board_save_duration_seconds",
            "Время записи изменений доски в базу",
            registry=self.registry,
        )
        self.compactions = Counter(
            "whatever_board_compactions",
            "Сжатия истории досок в один снимок",
            registry=self.registry,
        )
        self.presence_dropped = Counter(
            "whatever_presence_dropped",
            "Отброшенные сообщения присутствия: слишком большие или слишком частые",
            registry=self.registry,
        )
        self.slow_clients = Counter(
            "whatever_slow_client_disconnects",
            "Участники, отключённые за то, что не успевали принимать изменения",
            registry=self.registry,
        )
        self._rooms: Callable[[], int] = lambda: 0
        self._connections: Callable[[], int] = lambda: 0
        Gauge("whatever_rooms_open", "Открытые доски", registry=self.registry).set_function(
            lambda: self._rooms()
        )
        Gauge("whatever_connections", "Подключения к доскам", registry=self.registry).set_function(
            lambda: self._connections()
        )

    def watch(self, *, rooms: Callable[[], int], connections: Callable[[], int]) -> None:
        """Откуда брать число открытых досок и подключений (их держит RoomManager)."""
        self._rooms = rooms
        self._connections = connections

    def render(self) -> tuple[bytes, str]:
        """Показатели в текстовом формате Prometheus и тип содержимого ответа."""
        return generate_latest(self.registry), CONTENT_TYPE_LATEST


class RequestContext:
    """ASGI-обёртка: id запроса в журнале и ответе, время и код ответа в показателях."""

    def __init__(self, app: ASGIApp, metrics: Metrics) -> None:
        self.app = app
        self.metrics = metrics

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        incoming = dict(scope["headers"]).get(b"x-request-id", b"").decode("latin-1")
        rid = incoming if _VALID_REQUEST_ID.fullmatch(incoming) else uuid.uuid4().hex
        token = request_id.set(rid)
        try:
            if scope["type"] == "http":
                await self._http(scope, receive, send, rid)
            else:
                await self.app(scope, receive, send)
        finally:
            request_id.reset(token)

    async def _http(self, scope: Scope, receive: Receive, send: Send, rid: str) -> None:
        status = 500
        started = time.perf_counter()

        async def send_with_id(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                MutableHeaders(scope=message).append("X-Request-ID", rid)
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        finally:
            self.metrics.requests.labels(
                method=scope["method"], route=route_template(scope), status=str(status)
            ).observe(time.perf_counter() - started)


def route_template(scope: Scope) -> str:
    """Путь запроса с параметрами вместо значений: /api/boards/{board_id}.

    В метках показателей нужен шаблон, а не сам путь: id досок раздули бы число рядов без
    предела. Запрос, не нашедший обработчика, — «unmatched» по той же причине.
    """
    if not isinstance(scope.get("route"), BaseRoute):
        return "unmatched"
    names = {str(value): name for name, value in scope.get("path_params", {}).items()}
    segments = str(scope["path"]).split("/")
    return "/".join(f"{{{names[s]}}}" if s in names else s for s in segments)
