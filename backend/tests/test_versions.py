"""История версий: названные версии, список, содержимое версии и права на них.

Как и когда комната сама сохраняет версии, проверяют тесты комнаты (test_room.py).
"""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from pycrdt import Doc, Map

from app.sync.room import VERSIONS_CHANGED
from tests.conftest import act_as, sign_in
from tests.test_access import new_board, share
from tests.test_sync import YClient


def save_version(client: TestClient, board: dict[str, Any], name: str) -> dict[str, Any]:
    response = client.post(f"/api/boards/{board['id']}/versions", json={"name": name})
    assert response.status_code == 201, response.text
    version: dict[str, Any] = response.json()
    return version


def versions(client: TestClient, board: dict[str, Any]) -> list[dict[str, Any]]:
    response = client.get(f"/api/boards/{board['id']}/versions")
    assert response.status_code == 200, response.text
    result: list[dict[str, Any]] = response.json()
    return result


def elements_of(client: TestClient, version: dict[str, Any]) -> dict[str, Any]:
    response = client.get(f"/api/versions/{version['id']}/state")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/octet-stream"
    assert "immutable" in response.headers["cache-control"]
    doc: Doc[Any] = Doc()
    doc.apply_update(response.content)
    elements: dict[str, Any] = doc.get("elements", type=Map).to_py()
    return elements


def changes_heard(ws: Any) -> None:
    """Ждёт сообщения «список версий изменился». Сообщения синхронизации пропускаются."""
    while ws.receive_bytes() != VERSIONS_CHANGED:
        pass


def test_a_named_version_keeps_what_is_on_the_board(anon_client: TestClient) -> None:
    client = anon_client
    owner = sign_in(client)
    board = new_board(client)
    with client.websocket_connect(f"/ws/boards/{board['id']}") as ws:
        alice = YClient(ws)
        alice.handshake()
        alice.set("shape-1", {"kind": "rectangle", "x": 10})
        alice.flush()
        # Правка ещё не записана в базу, но в версию попадает: версию сохраняет комната доски.
        version = save_version(client, board, "  Перед ревью  ")
        assert version["name"] == "Перед ревью"
        assert version["saved_by"]["id"] == owner.id
        assert [person["id"] for person in version["editors"]] == [owner.id]
        changes_heard(ws)
    assert elements_of(client, version) == {"shape-1": {"kind": "rectangle", "x": 10}}

    # Доска закрыта: версия берётся из базы. Последние правки уже вошли в версию при закрытии.
    later = save_version(client, board, "Итог")
    assert later["editors"] == []
    assert [v["name"] for v in versions(client, board)] == ["Итог", "Перед ревью"]
    assert elements_of(client, later) == elements_of(client, version)


def test_an_automatic_version_can_be_named_to_keep_it(client: TestClient) -> None:
    board = new_board(client)
    with client.websocket_connect(f"/ws/boards/{board['id']}") as ws:
        alice = YClient(ws)
        alice.handshake()
        alice.set("shape-1", 1)
        alice.flush()
    # Названная версия ждёт, пока закроется комната: та сохраняет свою версию первой.
    save_version(client, board, "Итог")
    [_, automatic] = versions(client, board)
    assert automatic["name"] is None
    assert automatic["saved_by"] is None
    assert len(automatic["editors"]) == 1

    response = client.patch(f"/api/versions/{automatic['id']}", json={"name": "Релиз 1.0"})
    assert response.status_code == 200, response.text
    assert response.json() == {**automatic, "name": "Релиз 1.0"}


@pytest.mark.parametrize("name", ["", "   ", "x" * 201])
def test_a_version_needs_a_name(client: TestClient, name: str) -> None:
    board = new_board(client)
    assert (
        client.post(f"/api/boards/{board['id']}/versions", json={"name": name}).status_code == 422
    )
    version = save_version(client, board, "Есть")
    assert client.patch(f"/api/versions/{version['id']}", json={"name": name}).status_code == 422


def test_editors_use_the_history_and_managers_delete_from_it(anon_client: TestClient) -> None:
    client = anon_client
    viewer, editor, stranger = sign_in(client), sign_in(client), sign_in(client)
    owner = sign_in(client)
    board = new_board(client)
    share(client, board, viewer, "viewer")
    share(client, board, editor, "editor")
    version = save_version(client, board, "Владелец")
    urls = [
        ("GET", f"/api/boards/{board['id']}/versions", None),
        ("POST", f"/api/boards/{board['id']}/versions", {"name": "Можно?"}),
        ("GET", f"/api/versions/{version['id']}/state", None),
        ("PATCH", f"/api/versions/{version['id']}", {"name": "Можно?"}),
        ("DELETE", f"/api/versions/{version['id']}", None),
    ]

    # История — для тех, кто правит доску: восстановить версию значит изменить доску.
    act_as(client, viewer)
    for method, url, body in urls:
        response = client.request(method, url, json=body)
        assert response.status_code == 403, (method, url)
        assert response.json() == {"detail": "Недостаточно прав для этого действия"}

    act_as(client, editor)
    statuses = [client.request(method, url, json=body).status_code for method, url, body in urls]
    assert statuses == [200, 201, 200, 200, 403]

    act_as(client, stranger)
    response = client.get(f"/api/versions/{version['id']}/state")
    assert response.json() == {"detail": "Нет доступа к доске. Попросите владельца поделиться ею."}

    act_as(client, owner)
    assert client.delete(f"/api/versions/{version['id']}").status_code == 204
    assert [v["name"] for v in versions(client, board)] == ["Можно?"]
    response = client.get(f"/api/versions/{version['id']}/state")
    assert response.status_code == 404
    assert response.json() == {"detail": "Версия не найдена: возможно, её удалили"}


def test_open_boards_hear_about_every_change_in_the_history(client: TestClient) -> None:
    board = new_board(client)
    with client.websocket_connect(f"/ws/boards/{board['id']}") as ws:
        YClient(ws).handshake()
        version = save_version(client, board, "Первая")
        changes_heard(ws)
        client.patch(f"/api/versions/{version['id']}", json={"name": "Вторая"})
        changes_heard(ws)
        client.delete(f"/api/versions/{version['id']}")
        changes_heard(ws)


def test_a_deleted_board_takes_its_versions_along(client: TestClient) -> None:
    board = new_board(client)
    version = save_version(client, board, "Перед удалением")
    assert client.delete(f"/api/boards/{board['id']}").status_code == 204
    assert client.get(f"/api/versions/{version['id']}/state").status_code == 404
