"""Нагрузочный тест синхронизации досок.

Запускает N участников (по умолчанию 100, столько заказчик ждёт одновременно) на нескольких
досках. Каждый участник подключается по WebSocket так же, как браузер, и всё время теста
двигает курсор и меняет доску. Тест измеряет, через сколько изменение одного участника
доходит до остальных на той же доске, и сколько подключений сервер оборвал.

    cd backend
    LOAD_PASSWORD=... uv run python -m scripts.load --url http://localhost:8080 --login admin

Учётная запись нужна любая, которая может создавать доски. Тест создаёт свои доски и удаляет
их в конце. Ресурсы сервера во время теста смотрите в `docker stats`.

Все участники работают в одном процессе. Если сам процесс теста не успевает (задержка его
цикла событий велика), измеренные задержки завышены, и тест об этом предупреждает.
"""

import argparse
import asyncio
import contextlib
import getpass
import os
import random
import statistics
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol, cast

import httpx
from pycrdt import (
    Awareness,
    Doc,
    Map,
    MapEvent,
    YMessageType,
    YSyncMessageType,
    create_awareness_message,
    create_sync_message,
    create_update_message,
    handle_sync_message,
)
from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import ConnectionClosed

# Если цикл событий теста опаздывает больше этого, задержки сервера измерить нельзя.
LOOP_LAG_WARNING = 0.05


class ChangedKeys(Protocol):
    """Поле keys события MapEvent: в pycrdt оно объявлено только в __slots__, без типа."""

    keys: dict[str, dict[str, Any]]


@dataclass
class Stats:
    sync_times: list[float] = field(default_factory=list)
    latencies: list[float] = field(default_factory=list)
    edits_sent: int = 0
    presence_sent: int = 0
    presence_received: int = 0
    failures: list[str] = field(default_factory=list)
    loop_lag: float = 0.0


# Сколько секунд после конца теста участники ещё слушают: доходят последние изменения.
DRAIN_SECONDS = 2.0


@dataclass(frozen=True)
class Load:
    # Все начинают работать, когда подключились все: изменение, отправленное раньше, чем
    # подключился сосед, дошло бы до него в первой синхронизации, а не как изменение.
    start: float
    # Общий для всех момент остановки (time.perf_counter): после него никто не отправляет,
    # поэтому каждое изменение должно дойти до всех остальных участников доски.
    until: float
    edits_per_second: float
    cursor_per_second: float


class Participant:
    """Участник доски: свой документ Yjs, присутствие и подключение к серверу."""

    def __init__(self, name: str, ws: ClientConnection, stats: Stats) -> None:
        self.name = name
        self.ws = ws
        self.stats = stats
        self.doc: Doc[Any] = Doc()
        self.elements = self.doc.get("elements", type=Map)
        self.awareness = Awareness(self.doc)
        self.own_change = False

    async def handshake(self) -> None:
        """Обмен шагами синхронизации, как у y-websocket: ответ на шаг 1 сервера и свой шаг 1."""
        started = time.perf_counter()
        server_step1 = await self.receive(YMessageType.SYNC)
        reply = handle_sync_message(server_step1[1:], self.doc)
        if reply is not None:
            await self.ws.send(reply)
        await self.ws.send(create_sync_message(self.doc))
        while (await self.receive(YMessageType.SYNC))[1] != YSyncMessageType.SYNC_STEP2:
            pass
        self.stats.sync_times.append(time.perf_counter() - started)
        self.elements.observe(self._on_change)

    async def receive(self, kind: YMessageType) -> bytes:
        while True:
            message = await self.ws.recv(decode=False)
            if message[0] == kind:
                if kind == YMessageType.SYNC:
                    handle_sync_message(message[1:], self.doc)
                return message

    def _on_change(self, event: MapEvent) -> None:
        if self.own_change:
            return
        now = time.perf_counter()
        for change in cast("ChangedKeys", event).keys.values():
            value = change.get("newValue")
            if isinstance(value, dict) and isinstance(value.get("sent"), float):
                self.stats.latencies.append(now - value["sent"])

    async def listen(self) -> None:
        """Принимает всё, что рассылает сервер: изменения применяет, присутствие считает."""
        async for message in self.ws:
            if not isinstance(message, bytes) or not message:
                continue
            if message[0] == YMessageType.SYNC:
                handle_sync_message(message[1:], self.doc)
            elif message[0] == YMessageType.AWARENESS:
                self.stats.presence_received += 1

    async def work(self, load: Load) -> None:
        """Курсор cursor_per_second раз в секунду, изменение доски edits_per_second раз."""
        tick = 1 / load.cursor_per_second
        edit_every = max(1, round(load.cursor_per_second / load.edits_per_second))
        # Участники начинают в разные моменты, как живые люди, а не все в один такт.
        jitter = random.uniform(0, tick)  # noqa: S311 — не криптография
        await asyncio.sleep(load.start + jitter - time.perf_counter())
        n = 0
        while time.perf_counter() < load.until:
            n += 1
            await self.move_cursor(n)
            if n % edit_every == 0:
                await self.edit(n)
            await asyncio.sleep(tick)

    async def move_cursor(self, n: int) -> None:
        self.awareness.set_local_state(
            {"user": {"name": self.name}, "cursor": {"x": n % 1000, "y": n // 1000}}
        )
        update = self.awareness.encode_awareness_update([self.doc.client_id])
        await self.ws.send(create_awareness_message(update))
        self.stats.presence_sent += 1

    async def edit(self, n: int) -> None:
        updates: list[bytes] = []
        sub = self.doc.observe(lambda event: updates.append(event.update))
        self.own_change = True
        try:
            self.elements[f"{self.name}-{n}"] = {"sent": time.perf_counter(), "x": n, "y": n}
        finally:
            self.own_change = False
            self.doc.unobserve(sub)
        for update in updates:
            await self.ws.send(create_update_message(update))
        self.stats.edits_sent += 1


async def participate(
    name: str, url: str, headers: dict[str, str], load: Load, stats: Stats
) -> None:
    try:
        async with connect(url, additional_headers=headers, max_size=None) as ws:
            participant = Participant(name, ws, stats)
            await participant.handshake()
            listener = asyncio.create_task(participant.listen())
            await participant.work(load)
            await asyncio.sleep(load.until + DRAIN_SECONDS - time.perf_counter())
            listener.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await listener
    except ConnectionClosed as closed:
        stats.failures.append(f"{name}: connection closed {closed.rcvd}")
    except OSError as error:
        stats.failures.append(f"{name}: {error!r}")


async def watch_loop_lag(stats: Stats, stop: asyncio.Event) -> None:
    """Насколько цикл событий самого теста опаздывает: при большой задержке тест врёт."""
    while not stop.is_set():
        started = time.perf_counter()
        await asyncio.sleep(0.1)
        stats.loop_lag = max(stats.loop_lag, time.perf_counter() - started - 0.1)


def percentile(values: list[float], p: float) -> float:
    if len(values) < 2:
        return values[0] if values else 0.0
    return statistics.quantiles(values, n=100, method="inclusive")[round(p) - 1]


def peers_on_board(args: argparse.Namespace) -> int:
    """Сколько других участников получает каждое изменение."""
    clients_per_board: int = args.clients // args.boards
    return clients_per_board - 1


def report(stats: Stats, args: argparse.Namespace) -> list[str]:
    ms: Callable[[float], str] = lambda seconds: f"{seconds * 1000:.0f} мс"  # noqa: E731
    lat = stats.latencies
    expected = stats.edits_sent * peers_on_board(args)
    lines = [
        f"Участников: {args.clients} на {args.boards} досках, {args.duration:.0f} с работы",
        f"Подключение и первая синхронизация: p50 {ms(percentile(stats.sync_times, 50))}, "
        f"p95 {ms(percentile(stats.sync_times, 95))}",
        f"Изменений отправлено: {stats.edits_sent}, получено другими: {len(lat)} из {expected}",
        f"Задержка изменения до других участников: p50 {ms(percentile(lat, 50))}, "
        f"p95 {ms(percentile(lat, 95))}, p99 {ms(percentile(lat, 99))}, "
        f"max {ms(max(lat, default=0.0))}",
        f"Присутствие: отправлено {stats.presence_sent / args.duration:.0f}/с, "
        f"получено {stats.presence_received / args.duration:.0f}/с",
        f"Оборванных подключений: {len(stats.failures)}",
        f"Задержка цикла событий теста: {ms(stats.loop_lag)}",
    ]
    lines += [f"  {failure}" for failure in stats.failures[:10]]
    return lines


async def main(args: argparse.Namespace) -> int:
    password = os.environ.get("LOAD_PASSWORD") or getpass.getpass("Пароль: ")
    base = args.url.rstrip("/")
    origin = {"Origin": base}
    async with httpx.AsyncClient(base_url=f"{base}/api", headers=origin) as api:
        signed_in = await api.post("/auth/login", json={"login": args.login, "password": password})
        signed_in.raise_for_status()
        cookie = "; ".join(f"{name}={value}" for name, value in api.cookies.items())
        boards: list[str] = []
        try:
            for i in range(args.boards):
                created = await api.post("/boards", json={"name": f"Нагрузка {i + 1}"})
                created.raise_for_status()
                boards.append(created.json()["id"])
            stats = Stats()
            ws_base = base.replace("http", "ws", 1)
            headers = {"Cookie": cookie, **origin}
            started = time.perf_counter()
            begin = started + args.ramp + 1
            load = Load(begin, begin + args.duration, args.edits, args.cursor)
            stop = asyncio.Event()
            lag = asyncio.create_task(watch_loop_lag(stats, stop))
            async with asyncio.TaskGroup() as group:
                for i in range(args.clients):
                    url = f"{ws_base}/ws/boards/{boards[i % len(boards)]}"
                    group.create_task(participate(f"u{i}", url, headers, load, stats))
                    await asyncio.sleep(args.ramp / args.clients)
            stop.set()
            await lag
        finally:
            for board in boards:
                await api.delete(f"/boards/{board}")
    print("\n".join(report(stats, args)))
    if stats.loop_lag > LOOP_LAG_WARNING:
        print("Внимание: тест сам не успевал, задержки завышены.", file=sys.stderr)
    p95 = percentile(stats.latencies, 95)
    complete = len(stats.latencies) == stats.edits_sent * peers_on_board(args)
    ok = complete and not stats.failures and p95 * 1000 <= args.max_p95_ms
    return 0 if ok else 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else None)
    parser.add_argument("--url", default="http://localhost:8080", help="адрес приложения")
    parser.add_argument("--login", required=True, help="учётная запись (пароль — LOAD_PASSWORD)")
    parser.add_argument("--clients", type=int, default=100, help="участников (100)")
    parser.add_argument("--boards", type=int, default=5, help="досок (5)")
    parser.add_argument(
        "--duration", type=float, default=60, help="секунд работы после подключения всех (60)"
    )
    parser.add_argument("--ramp", type=float, default=5, help="секунд на подключение всех (5)")
    parser.add_argument("--cursor", type=float, default=10, help="курсор, раз в секунду (10)")
    parser.add_argument("--edits", type=float, default=1, help="изменения, раз в секунду (1)")
    parser.add_argument(
        "--max-p95-ms", type=float, default=200, help="предел p95 задержки, иначе код 1 (200)"
    )
    args = parser.parse_args()
    if args.clients % args.boards != 0:
        parser.error("участники делятся на доски поровну: --clients кратно --boards")
    return args


if __name__ == "__main__":
    sys.exit(asyncio.run(main(parse_args())))
