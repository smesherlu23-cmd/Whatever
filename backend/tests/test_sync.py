"""Проверка синхронизации: Python-клиенты на pycrdt говорят с сервером по протоколу Yjs."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from pycrdt import (
    Awareness,
    Doc,
    Map,
    YMessageType,
    YSyncMessageType,
    create_awareness_message,
    create_sync_message,
    create_update_message,
    handle_sync_message,
    read_message,
)
from starlette.websockets import WebSocketDisconnect

from app.models import Role
from tests.conftest import PASSWORD, Account, act_as, log_in, sign_in


class YClient:
    """Минимальный клиент Yjs поверх тестового WebSocket."""

    def __init__(self, ws: Any) -> None:
        self.ws = ws
        self.doc: Doc[Any] = Doc()
        self.elements = self.doc.get("elements", type=Map)

    def handshake(self) -> None:
        # Сервер присылает свой шаг 1, клиент отвечает шагом 2 и отправляет свой шаг 1.
        server_step1 = self.ws.receive_bytes()
        assert server_step1[0] == YMessageType.SYNC
        reply = handle_sync_message(server_step1[1:], self.doc)
        assert reply is not None
        self.ws.send_bytes(reply)
        self.ws.send_bytes(create_sync_message(self.doc))
        self.receive_sync(YSyncMessageType.SYNC_STEP2)

    def receive_sync(self, expected: YSyncMessageType) -> None:
        while True:
            message = self.ws.receive_bytes()
            if message[0] != YMessageType.SYNC:
                continue
            assert message[1] == expected
            handle_sync_message(message[1:], self.doc)
            return

    def flush(self) -> None:
        """Ждёт, пока сервер обработает всё отправленное: он отвечает на сообщения по порядку."""
        self.ws.send_bytes(create_sync_message(self.doc))
        self.receive_sync(YSyncMessageType.SYNC_STEP2)

    def set(self, key: str, value: Any) -> None:
        updates: list[bytes] = []
        sub = self.doc.observe(lambda event: updates.append(event.update))
        self.elements[key] = value
        self.doc.unobserve(sub)
        for u in updates:
            self.ws.send_bytes(create_update_message(u))


def new_board(client: TestClient) -> str:
    board_id: str = client.post("/api/boards", json={"name": "Тест"}).json()["id"]
    return board_id


def test_changes_reach_other_participants(client: TestClient) -> None:
    board = new_board(client)
    with client.websocket_connect(f"/ws/boards/{board}") as a_ws:
        alice = YClient(a_ws)
        alice.handshake()
        with client.websocket_connect(f"/ws/boards/{board}") as b_ws:
            bob = YClient(b_ws)
            bob.handshake()
            alice.set("shape-1", {"kind": "rectangle", "x": 10})
            bob.receive_sync(YSyncMessageType.SYNC_UPDATE)
            assert bob.elements.to_py()["shape-1"]["x"] == 10
            alice.flush()


def test_board_is_restored_after_everyone_leaves(client: TestClient) -> None:
    board = new_board(client)
    with client.websocket_connect(f"/ws/boards/{board}") as ws:
        alice = YClient(ws)
        alice.handshake()
        for i in range(60):  # больше порога сжатия
            alice.set(f"shape-{i}", {"kind": "ellipse", "x": i})
        alice.flush()

    with client.websocket_connect(f"/ws/boards/{board}") as ws:
        carol = YClient(ws)
        carol.handshake()
        assert len(carol.elements.to_py()) == 60
        assert carol.elements.to_py()["shape-59"]["x"] == 59


def test_offline_edits_are_merged_on_reconnect(client: TestClient) -> None:
    board = new_board(client)
    with client.websocket_connect(f"/ws/boards/{board}") as ws:
        alice = YClient(ws)
        alice.handshake()
        alice.set("online", 1)
        alice.flush()

    # Изменение сделано без связи, клиент отдаёт его серверу в ответе на шаг 1.
    alice.elements["offline"] = 2
    with client.websocket_connect(f"/ws/boards/{board}") as ws:
        alice.ws = ws
        alice.handshake()
        alice.flush()
    with client.websocket_connect(f"/ws/boards/{board}") as ws:
        bob = YClient(ws)
        bob.handshake()
        assert bob.elements.to_py() == {"online": 1, "offline": 2}


def test_presence_is_shared_and_cleared_on_leave(client: TestClient) -> None:
    board = new_board(client)
    with client.websocket_connect(f"/ws/boards/{board}") as b_ws:
        bob = YClient(b_ws)
        bob.handshake()
        with client.websocket_connect(f"/ws/boards/{board}") as a_ws:
            alice = YClient(a_ws)
            alice.handshake()
            awareness = Awareness(alice.doc)
            awareness.set_local_state({"user": {"name": "Алиса"}, "cursor": {"x": 1, "y": 2}})
            update = awareness.encode_awareness_update([alice.doc.client_id])
            a_ws.send_bytes(create_awareness_message(update))

            message = b_ws.receive_bytes()
            assert message[0] == YMessageType.AWARENESS
            bob_view = Awareness(bob.doc)
            bob_view.apply_awareness_update(read_message(message[1:]), "server")
            assert bob_view.states[alice.doc.client_id]["user"]["name"] == "Алиса"

        # Алиса отключилась: Боб получает удаление её присутствия.
        message = b_ws.receive_bytes()
        assert message[0] == YMessageType.AWARENESS
        bob_view.apply_awareness_update(read_message(message[1:]), "server")
        assert alice.doc.client_id not in bob_view.states


def test_unknown_board_is_rejected(client: TestClient) -> None:
    missing = "/ws/boards/00000000-0000-0000-0000-000000000000"
    with client.websocket_connect(missing) as ws, pytest.raises(WebSocketDisconnect) as closed:
        ws.receive_bytes()
    assert closed.value.code == 4404


def test_sync_needs_a_login(client: TestClient) -> None:
    board = new_board(client)
    client.post("/api/auth/logout")
    with (
        client.websocket_connect(f"/ws/boards/{board}") as ws,
        pytest.raises(WebSocketDisconnect) as closed,
    ):
        ws.receive_bytes()
    assert closed.value.code == 4401


def test_sync_from_another_site_is_rejected(client: TestClient) -> None:
    board = new_board(client)
    headers = {"Origin": "https://evil.example"}
    with (
        client.websocket_connect(f"/ws/boards/{board}", headers=headers) as ws,
        pytest.raises(WebSocketDisconnect) as closed,
    ):
        ws.receive_bytes()
    assert closed.value.code == 4403


def close_code(ws: Any) -> int:
    """Код, с которым сервер закрыл соединение. Сообщения, пришедшие раньше, пропускаются."""
    while True:
        try:
            ws.receive_bytes()
        except WebSocketDisconnect as closed:
            return closed.code


def test_blocking_a_user_disconnects_their_open_boards(anon_client: TestClient) -> None:
    client = anon_client
    admin = sign_in(client, Role.ADMIN)
    user = sign_in(client)
    board = new_board(client)

    with client.websocket_connect(f"/ws/boards/{board}") as ws:
        YClient(ws).handshake()
        act_as(client, admin)
        client.patch(f"/api/admin/users/{user.id}", json={"is_active": False})
        assert close_code(ws) == 4401


def test_password_change_disconnects_other_devices_only(client: TestClient) -> None:
    board = new_board(client)
    login = client.get("/api/auth/me").json()["login"]
    this_browser = dict(client.cookies)
    log_in(client, login)  # вход с другого устройства

    with client.websocket_connect(f"/ws/boards/{board}") as other_ws:
        YClient(other_ws).handshake()
        client.cookies.clear()
        client.cookies.update(this_browser)
        with client.websocket_connect(f"/ws/boards/{board}") as this_ws:
            this = YClient(this_ws)
            this.handshake()
            changed = client.post(
                "/api/auth/password",
                json={"current_password": PASSWORD, "new_password": "brand-new-password"},
            )
            assert changed.status_code == 204
            assert close_code(other_ws) == 4401
            this.set("still-here", 1)
            this.flush()


def test_logout_disconnects_boards_of_this_session(client: TestClient) -> None:
    board = new_board(client)
    with client.websocket_connect(f"/ws/boards/{board}") as ws:
        YClient(ws).handshake()
        client.post("/api/auth/logout")
        assert close_code(ws) == 4401


def share(client: TestClient, board: str, user: Account, role: str) -> None:
    response = client.put(f"/api/boards/{board}/members/{user.id}", json={"role": role})
    assert response.status_code == 200, response.text


def test_viewer_sees_changes_but_cannot_make_them(anon_client: TestClient) -> None:
    client = anon_client
    viewer = sign_in(client)
    owner = sign_in(client)
    board = new_board(client)
    share(client, board, viewer, "viewer")

    with client.websocket_connect(f"/ws/boards/{board}") as owner_ws:
        alice = YClient(owner_ws)
        alice.handshake()
        alice.set("by-owner", 1)
        alice.flush()
        act_as(client, viewer)
        with client.websocket_connect(f"/ws/boards/{board}") as viewer_ws:
            bob = YClient(viewer_ws)
            bob.handshake()
            assert bob.elements.to_py() == {"by-owner": 1}
            # Изменение зрителя сервер не применяет и никому не пересылает.
            bob.set("by-viewer", 2)
            bob.flush()
            alice.set("after", 3)
            bob.receive_sync(YSyncMessageType.SYNC_UPDATE)
            assert "after" in bob.elements.to_py()

    act_as(client, owner)
    with client.websocket_connect(f"/ws/boards/{board}") as ws:
        carol = YClient(ws)
        carol.handshake()
        assert carol.elements.to_py() == {"by-owner": 1, "after": 3}


def test_board_without_access_is_rejected(anon_client: TestClient) -> None:
    client = anon_client
    sign_in(client)
    board = new_board(client)
    sign_in(client)
    with (
        client.websocket_connect(f"/ws/boards/{board}") as ws,
        pytest.raises(WebSocketDisconnect) as closed,
    ):
        ws.receive_bytes()
    assert closed.value.code == 4403


def test_changing_access_reconnects_the_member(anon_client: TestClient) -> None:
    client = anon_client
    member = sign_in(client)
    owner = sign_in(client)
    board = new_board(client)
    share(client, board, member, "editor")

    act_as(client, member)
    with client.websocket_connect(f"/ws/boards/{board}") as ws:
        YClient(ws).handshake()
        act_as(client, owner)
        share(client, board, member, "viewer")
        # Клиент переподключится сам и получит права заново.
        assert close_code(ws) == 4100

    act_as(client, member)
    with client.websocket_connect(f"/ws/boards/{board}") as ws:
        YClient(ws).handshake()
        act_as(client, owner)
        assert client.delete(f"/api/boards/{board}/members/{member.id}").status_code == 204
        assert close_code(ws) == 4100

    act_as(client, member)
    with client.websocket_connect(f"/ws/boards/{board}") as ws:
        assert close_code(ws) == 4403


def test_demoted_admin_rechecks_access_to_open_boards(anon_client: TestClient) -> None:
    client = anon_client
    admin = sign_in(client, Role.ADMIN)
    demoted = sign_in(client, Role.ADMIN)
    sign_in(client)
    board = new_board(client)

    act_as(client, demoted)
    with client.websocket_connect(f"/ws/boards/{board}") as ws:
        YClient(ws).handshake()
        act_as(client, admin)
        client.patch(f"/api/admin/users/{demoted.id}", json={"role": "user"})
        assert close_code(ws) == 4100


def test_deleting_a_board_disconnects_everyone(client: TestClient) -> None:
    board = new_board(client)
    with client.websocket_connect(f"/ws/boards/{board}") as ws:
        alice = YClient(ws)
        alice.handshake()
        alice.set("unsaved", 1)
        alice.flush()
        assert client.delete(f"/api/boards/{board}").status_code == 204
        assert close_code(ws) == 4404
    assert client.get(f"/api/boards/{board}").status_code == 404
