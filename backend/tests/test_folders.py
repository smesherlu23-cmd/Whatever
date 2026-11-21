"""Личные папки: вложенность, перенос досок, удаление без потери содержимого."""

from typing import Any

from fastapi.testclient import TestClient

from tests.conftest import act_as, sign_in


def new_folder(client: TestClient, name: str, parent: str | None = None) -> str:
    response = client.post("/api/folders", json={"name": name, "parent_id": parent})
    assert response.status_code == 201, response.text
    folder_id: str = response.json()["id"]
    return folder_id


def boards_by_id(client: TestClient) -> dict[str, dict[str, Any]]:
    return {b["id"]: b for b in client.get("/api/boards").json()}


def test_folders_nest_and_hold_boards(client: TestClient) -> None:
    projects = new_folder(client, "Проекты")
    backend = new_folder(client, "Бэкенд", projects)
    board = client.post("/api/boards", json={"name": "API", "folder_id": backend}).json()
    assert board["folder_id"] == backend

    folders = {f["name"]: f for f in client.get("/api/folders").json()}
    assert folders["Бэкенд"]["parent_id"] == projects
    renamed = client.patch(f"/api/folders/{projects}", json={"name": "Работа"})
    assert renamed.json()["name"] == "Работа"

    moved = client.patch(f"/api/boards/{board['id']}", json={"folder_id": projects})
    assert moved.json()["folder_id"] == projects
    to_root = client.patch(f"/api/boards/{board['id']}", json={"folder_id": None})
    assert to_root.json()["folder_id"] is None
    assert to_root.json()["name"] == "API"


def test_deleting_a_folder_lifts_its_contents(client: TestClient) -> None:
    outer = new_folder(client, "Внешняя")
    inner = new_folder(client, "Внутренняя", outer)
    nested = new_folder(client, "Вложенная", inner)
    board = client.post("/api/boards", json={"folder_id": inner}).json()

    assert client.delete(f"/api/folders/{inner}").status_code == 204
    folders = {f["id"]: f for f in client.get("/api/folders").json()}
    assert inner not in folders
    assert folders[nested]["parent_id"] == outer
    assert boards_by_id(client)[board["id"]]["folder_id"] == outer


def test_folders_are_personal(anon_client: TestClient) -> None:
    client = anon_client
    editor = sign_in(client)
    mine = new_folder(client, "Моя")
    owner = sign_in(client)
    board = client.post("/api/boards", json={}).json()
    client.put(f"/api/boards/{board['id']}/members/{editor.id}", json={"role": "editor"})

    # Чужая папка выглядит как несуществующая.
    assert client.get("/api/folders").json() == []
    assert client.post("/api/boards", json={"folder_id": mine}).status_code == 404
    assert client.patch(f"/api/boards/{board['id']}", json={"folder_id": mine}).status_code == 404
    assert client.post("/api/folders", json={"name": "Х", "parent_id": mine}).status_code == 404
    assert client.patch(f"/api/folders/{mine}", json={"name": "Х"}).status_code == 404
    assert client.delete(f"/api/folders/{mine}").status_code == 404

    # Участник с правом редактирования не раскладывает чужую доску по папкам,
    # а папку владельца не видит.
    owners = new_folder(client, "Владельца")
    client.patch(f"/api/boards/{board['id']}", json={"folder_id": owners})
    act_as(client, editor)
    assert boards_by_id(client)[board["id"]]["folder_id"] is None
    response = client.patch(f"/api/boards/{board['id']}", json={"folder_id": mine})
    assert response.status_code == 403
    act_as(client, owner)
    assert boards_by_id(client)[board["id"]]["folder_id"] == owners


def test_folder_name_is_required(client: TestClient) -> None:
    assert client.post("/api/folders", json={"name": ""}).status_code == 422
    folder = new_folder(client, "Папка")
    assert client.patch(f"/api/folders/{folder}", json={"name": ""}).status_code == 422
