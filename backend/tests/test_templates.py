"""Шаблоны: сохранение доски шаблоном, доски из шаблонов и из содержимого браузера."""

import base64
import uuid
from collections.abc import Iterable, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pycrdt import Doc, Map

from app.board_content import MAX_CONTENT_BYTES
from app.core.config import get_settings
from app.main import create_app
from app.models import Role
from tests.conftest import act_as, create_user, log_in, sign_in
from tests.test_access import board_ids, new_board, share
from tests.test_files import PNG, files_url, store, uploaded
from tests.test_sync import YClient


def elements(content: bytes) -> dict[str, Any]:
    """Элементы из состояния доски, которое отдал сервер."""
    doc: Doc[Any] = Doc()
    doc.apply_update(content)
    result: dict[str, Any] = doc.get("elements", type=Map).to_py()
    return result


def board_elements(client: TestClient, board_id: str) -> dict[str, Any]:
    response = client.get(f"/api/boards/{board_id}/content")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/octet-stream"
    return elements(response.content)


def draw(client: TestClient, board_id: str, **shapes: Any) -> None:
    """Рисует на доске через синхронизацию, как браузер."""
    with client.websocket_connect(f"/ws/boards/{board_id}") as ws:
        editor = YClient(ws)
        editor.handshake()
        for key, value in shapes.items():
            editor.set(key, value)
        editor.flush()


def save_template(client: TestClient, board_id: str, name: str = "C4") -> dict[str, Any]:
    response = client.post(f"/api/boards/{board_id}/template", json={"name": name})
    assert response.status_code == 201, response.text
    template: dict[str, Any] = response.json()
    return template


def template_ids(client: TestClient) -> list[str]:
    return [t["id"] for t in client.get("/api/templates").json()]


def listed_template(client: TestClient, template_id: str) -> dict[str, Any]:
    """Шаблон из общего списка. В тестовой базе есть и шаблоны других тестов."""
    template: dict[str, Any] = next(
        t for t in client.get("/api/templates").json() if t["id"] == template_id
    )
    return template


def content_of(**shapes: Any) -> str:
    """Состояние документа Yjs в base64, как его отправляет браузер."""
    doc: Doc[Any] = Doc()
    doc["elements"] = Map(shapes)
    return base64.b64encode(doc.get_update()).decode()


def test_a_template_is_a_copy_that_everyone_sees(anon_client: TestClient) -> None:
    client = anon_client
    colleague = sign_in(client)
    owner = sign_in(client)
    board = new_board(client, "Платёжный сервис")
    draw(client, board["id"], api={"kind": "rectangle", "text": "API"})

    template = save_template(client, board["id"], "Сервис: шаблон")
    assert template["name"] == "Сервис: шаблон"
    assert template["is_template"] is True
    assert template["access"] == "manage"
    assert template["owner"]["id"] == owner.id
    # Шаблон — копия: правки доски его не меняют.
    draw(client, board["id"], db={"kind": "database"})
    assert board_elements(client, template["id"]) == {"api": {"kind": "rectangle", "text": "API"}}
    assert template["id"] not in board_ids(client)
    assert board["id"] in board_ids(client)

    act_as(client, colleague)
    assert listed_template(client, template["id"])["access"] == "view"
    assert template["id"] not in board_ids(client)
    assert client.get(f"/api/boards/{template['id']}").json()["access"] == "view"
    assert "api" in board_elements(client, template["id"])
    path = f"/api/boards/{template['id']}"
    assert client.patch(path, json={"name": "Чужой"}).status_code == 403
    assert client.delete(path).status_code == 403


def test_a_template_is_opened_read_only_by_colleagues(anon_client: TestClient) -> None:
    client = anon_client
    colleague = sign_in(client)
    sign_in(client)
    template = save_template(client, new_board(client)["id"])

    act_as(client, colleague)
    draw(client, template["id"], shape={"kind": "ellipse"})
    assert board_elements(client, template["id"]) == {}


def test_a_board_is_created_from_a_template_with_its_files(anon_client: TestClient) -> None:
    client = anon_client
    colleague = sign_in(client)
    sign_in(client)
    board = new_board(client)
    file_id = uploaded(client, board["id"], PNG)
    draw(client, board["id"], picture={"kind": "image", "file": {"id": file_id}})
    template = save_template(client, board["id"])

    act_as(client, colleague)
    response = client.post(
        "/api/boards", json={"name": "Мой сервис", "template_id": template["id"]}
    )
    assert response.status_code == 201, response.text
    copy = response.json()
    assert copy["name"] == "Мой сервис"
    assert copy["access"] == "manage"
    assert copy["is_template"] is False
    assert board_elements(client, copy["id"])["picture"]["file"]["id"] == file_id
    assert client.get(files_url(copy["id"], file_id)).content == PNG
    assert copy["id"] in board_ids(client)

    # Файлы копии не зависят от источника: доски и шаблон можно удалять по отдельности.
    sign_in(client, Role.ADMIN)
    assert client.delete(f"/api/boards/{board['id']}").status_code == 204
    assert client.delete(f"/api/boards/{template['id']}").status_code == 204
    act_as(client, colleague)
    assert client.get(files_url(copy["id"], file_id)).content == PNG


def test_only_templates_are_copied(client: TestClient) -> None:
    board = new_board(client)
    for source in (board["id"], str(uuid.uuid4())):
        response = client.post("/api/boards", json={"template_id": source})
        assert response.status_code == 404
        assert response.json()["detail"] == "Шаблон не найден"


def test_saving_a_template_needs_the_right_to_manage_the_board(
    anon_client: TestClient,
) -> None:
    client = anon_client
    editor = sign_in(client)
    sign_in(client)
    board = new_board(client)
    share(client, board, editor, "editor")
    before = template_ids(client)

    act_as(client, editor)
    response = client.post(f"/api/boards/{board['id']}/template", json={"name": "Мой"})
    assert response.status_code == 403
    assert template_ids(client) == before


def test_editors_of_a_template_can_change_it(anon_client: TestClient) -> None:
    client = anon_client
    editor = sign_in(client)
    sign_in(client)
    template = save_template(client, new_board(client)["id"])
    share(client, template, editor, "editor")

    act_as(client, editor)
    assert listed_template(client, template["id"])["access"] == "edit"
    renamed = client.patch(f"/api/boards/{template['id']}", json={"name": "Новое имя"})
    assert renamed.json()["name"] == "Новое имя"
    assert template["id"] not in board_ids(client)


def test_templates_are_listed_by_name_and_not_among_boards(admin_client: TestClient) -> None:
    client = admin_client
    board = new_board(client)
    names = ["Ретро", "Архитектура", "Модель данных"]
    ids = {name: save_template(client, board["id"], name)["id"] for name in names}
    listed = [t["name"] for t in client.get("/api/templates").json() if t["id"] in ids.values()]
    assert listed == sorted(names)
    assert not set(ids.values()) & set(board_ids(client, "?all=true"))


def test_templates_are_not_put_into_folders(client: TestClient) -> None:
    template = save_template(client, new_board(client)["id"])
    folder = client.post("/api/folders", json={"name": "Архив"}).json()
    response = client.patch(f"/api/boards/{template['id']}", json={"folder_id": folder["id"]})
    assert response.status_code == 400
    assert response.json()["detail"] == "Шаблоны не раскладываются по папкам"


def test_a_board_is_created_with_content_from_the_browser(client: TestClient) -> None:
    content = content_of(start={"kind": "terminal", "text": "Начало"})
    response = client.post("/api/boards", json={"name": "Процесс", "content": content})
    assert response.status_code == 201, response.text
    board = response.json()
    assert board_elements(client, board["id"]) == {"start": {"kind": "terminal", "text": "Начало"}}

    with client.websocket_connect(f"/ws/boards/{board['id']}") as ws:
        editor = YClient(ws)
        editor.handshake()
        assert editor.elements.to_py() == {"start": {"kind": "terminal", "text": "Начало"}}


@pytest.mark.parametrize(
    "body",
    [
        {"content": base64.b64encode(b"\x05garbage").decode()},
        {"content": "это не base64"},
        {"content": base64.b64encode(bytes(MAX_CONTENT_BYTES + 1)).decode()},
        {"content": content_of(), "template_id": str(uuid.uuid4())},
    ],
)
def test_broken_content_is_rejected(client: TestClient, body: dict[str, str]) -> None:
    before = board_ids(client)
    assert client.post("/api/boards", json=body).status_code == 422
    assert board_ids(client) == before


def test_broken_content_is_explained(client: TestClient) -> None:
    content = base64.b64encode(b"\x05garbage").decode()
    response = client.post("/api/boards", json={"content": content})
    assert response.json()["detail"] == "Содержимое доски повреждено"


def test_content_of_an_empty_board_is_an_empty_document(client: TestClient) -> None:
    assert board_elements(client, new_board(client)["id"]) == {}


@pytest.fixture
def slow_save_client() -> Iterator[TestClient]:
    """Комнаты пишут в базу только через минуту: в тесте записи сами по себе не будет."""
    settings = get_settings().model_copy(update={"sync_save_delay_seconds": 60})
    with TestClient(create_app(settings)) as client:
        log_in(client, create_user(client))
        yield client


def test_unsaved_changes_of_an_open_board_reach_the_copy(slow_save_client: TestClient) -> None:
    client = slow_save_client
    board = new_board(client)
    with client.websocket_connect(f"/ws/boards/{board['id']}") as ws:
        editor = YClient(ws)
        editor.handshake()
        editor.set("fresh", {"kind": "sticky"})
        editor.flush()
        template = save_template(client, board["id"])
        assert board_elements(client, template["id"]) == {"fresh": {"kind": "sticky"}}

        with client.websocket_connect(f"/ws/boards/{template['id']}") as template_ws:
            author = YClient(template_ws)
            author.handshake()
            author.set("added", {"kind": "ellipse"})
            author.flush()
            created = client.post("/api/boards", json={"template_id": template["id"]}).json()
            assert set(board_elements(client, created["id"])) == {"fresh", "added"}


def test_a_failed_copy_leaves_no_files(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    board = new_board(client)
    uploaded(client, board["id"], PNG)
    files = store(client)
    before = sorted(path.name for path in files.root.iterdir())
    templates = template_ids(client)
    copy_board = files.copy_board

    async def copy_then_fail(
        source: uuid.UUID, target: uuid.UUID, file_ids: Iterable[uuid.UUID]
    ) -> None:
        await copy_board(source, target, file_ids)
        raise OSError("диск заполнен")

    monkeypatch.setattr(files, "copy_board", copy_then_fail)
    with pytest.raises(OSError, match="диск заполнен"):
        client.post(f"/api/boards/{board['id']}/template", json={"name": "Сломанный"})
    assert sorted(path.name for path in files.root.iterdir()) == before
    assert template_ids(client) == templates
