from fastapi.testclient import TestClient


def test_board_lifecycle(client: TestClient) -> None:
    created = client.post("/api/boards", json={"name": "Архитектура"})
    assert created.status_code == 201
    board = created.json()
    assert board["name"] == "Архитектура"

    assert board["id"] in [b["id"] for b in client.get("/api/boards").json()]

    renamed = client.patch(f"/api/boards/{board['id']}", json={"name": "Схема сервисов"})
    assert renamed.json()["name"] == "Схема сервисов"

    assert client.delete(f"/api/boards/{board['id']}").status_code == 204
    assert client.get(f"/api/boards/{board['id']}").status_code == 404


def test_board_name_is_validated(client: TestClient) -> None:
    assert client.post("/api/boards", json={"name": ""}).status_code == 422
    assert client.post("/api/boards", json={}).json()["name"] == "Новая доска"


def test_rename_requires_a_name(client: TestClient) -> None:
    board = client.post("/api/boards", json={"name": "Схема"}).json()
    assert client.patch(f"/api/boards/{board['id']}", json={}).status_code == 422
    assert client.get(f"/api/boards/{board['id']}").json()["name"] == "Схема"
