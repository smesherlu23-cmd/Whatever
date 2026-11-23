"""Обсуждения на досках: метки, ответы, решённые вопросы, права на правку и удаление."""

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.access import access_to, people_with_access, viewable_by
from app.models import Board, Role, User
from app.sync.room import COMMENTS_CHANGED
from tests.conftest import Account, act_as, in_app_db, sign_in
from tests.test_access import new_board, share
from tests.test_sync import YClient

PIN: dict[str, Any] = {"page": "main", "x": 120.5, "y": -40}


def start_thread(
    client: TestClient, board: dict[str, Any], text: str = "Почему вызов синхронный?", **pin: Any
) -> dict[str, Any]:
    response = client.post(f"/api/boards/{board['id']}/threads", json={**PIN, **pin, "text": text})
    assert response.status_code == 201, response.text
    thread: dict[str, Any] = response.json()
    return thread


def reply(client: TestClient, thread: dict[str, Any], text: str) -> dict[str, Any]:
    response = client.post(f"/api/threads/{thread['id']}/comments", json={"text": text})
    assert response.status_code == 201, response.text
    updated: dict[str, Any] = response.json()
    return updated


def threads(client: TestClient, board: dict[str, Any]) -> list[dict[str, Any]]:
    response = client.get(f"/api/boards/{board['id']}/threads")
    assert response.status_code == 200, response.text
    result: list[dict[str, Any]] = response.json()
    return result


def test_anyone_who_sees_the_board_discusses_it(anon_client: TestClient) -> None:
    client = anon_client
    viewer, stranger = sign_in(client), sign_in(client)
    owner = sign_in(client)
    board = new_board(client)
    share(client, board, viewer, "viewer")

    # Зритель не меняет схему, но вопрос по ней задать может.
    act_as(client, viewer)
    thread = start_thread(client, board, "  Кто владелец очереди?  ")
    assert thread["page"] == "main"
    assert (thread["x"], thread["y"]) == (120.5, -40)
    assert thread["element"] is None
    assert thread["author"]["id"] == viewer.id
    assert thread["resolved_at"] is None
    [question] = thread["comments"]
    assert question["text"] == "Кто владелец очереди?"
    assert question["author"]["login"] == viewer.login
    assert question["mentions"] == []
    assert question["edited_at"] is None

    act_as(client, owner)
    assert threads(client, board) == [thread]

    act_as(client, stranger)
    assert client.get(f"/api/boards/{board['id']}/threads").status_code == 403
    response = client.post(f"/api/boards/{board['id']}/threads", json={**PIN, "text": "Можно?"})
    assert response.status_code == 403
    assert client.post(f"/api/threads/{thread['id']}/comments", json={"text": "А я?"}).json() == {
        "detail": "Нет доступа к доске. Попросите владельца поделиться ею."
    }


def test_a_pin_on_an_element_remembers_its_place_on_it(client: TestClient) -> None:
    board = new_board(client)
    element = {"id": "shape-1", "x": 1, "y": 0.25}
    thread = start_thread(client, board, element=element)
    assert thread["element"] == element
    assert threads(client, board)[0]["element"] == element


@pytest.mark.parametrize(
    "body",
    [
        {**PIN, "text": "   "},
        {**PIN, "text": "я" * 5001},
        {**PIN, "page": "", "text": "Вопрос"},
        {**PIN, "x": 1e10, "text": "Вопрос"},
        {**PIN, "element": {"id": "shape-1", "x": 1.5, "y": 0}, "text": "Вопрос"},
        {**PIN, "element": {"id": "shape-1", "x": 0.5}, "text": "Вопрос"},
        {"page": "main", "x": 0, "text": "Вопрос"},
    ],
)
def test_a_thread_needs_a_place_and_a_question(client: TestClient, body: dict[str, Any]) -> None:
    board = new_board(client)
    assert client.post(f"/api/boards/{board['id']}/threads", json=body).status_code == 422


def test_coordinates_must_be_numbers(client: TestClient) -> None:
    board = new_board(client)
    # Разборщик JSON в Python принимает NaN, хотя по стандарту его нет.
    response = client.post(
        f"/api/boards/{board['id']}/threads",
        content='{"page": "main", "x": NaN, "y": 0, "text": "Вопрос"}',
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422
    # Присланное значение в ответ не попадает: NaN в JSON не записать.
    [error] = response.json()["detail"]
    assert error["loc"] == ["body", "x"]
    assert "input" not in error


def test_replies_then_resolve_and_reopen(anon_client: TestClient) -> None:
    client = anon_client
    viewer = sign_in(client)
    owner = sign_in(client)
    board = new_board(client)
    share(client, board, viewer, "viewer")
    thread = start_thread(client, board)

    act_as(client, viewer)
    answered = reply(client, thread, "Так проще, но лучше через очередь")
    assert [c["text"] for c in answered["comments"]] == [
        "Почему вызов синхронный?",
        "Так проще, но лучше через очередь",
    ]
    assert answered["comments"][1]["author"]["id"] == viewer.id

    path = f"/api/threads/{thread['id']}"
    resolved = client.patch(path, json={"resolved": True}).json()
    assert resolved["resolved_at"] is not None
    assert resolved["resolved_by"]["id"] == viewer.id

    # Повторная отметка не меняет, кто и когда решил вопрос.
    act_as(client, owner)
    assert client.patch(path, json={"resolved": True}).json() == resolved

    reopened = client.patch(path, json={"resolved": False}).json()
    assert reopened["resolved_at"] is None
    assert reopened["resolved_by"] is None
    assert reopened["comments"] == answered["comments"]


def test_only_the_author_edits_a_comment(anon_client: TestClient) -> None:
    client = anon_client
    editor = sign_in(client)
    owner = sign_in(client)
    board = new_board(client)
    share(client, board, editor, "editor")
    thread = start_thread(client, board, "Опечатка: синхроный")
    comment_path = f"/api/comments/{thread['comments'][0]['id']}"

    act_as(client, editor)
    response = client.patch(comment_path, json={"text": "Чужая правка"})
    assert response.status_code == 403
    assert response.json()["detail"] == "Изменить комментарий может только автор"

    act_as(client, owner)
    edited = client.patch(comment_path, json={"text": "Почему вызов синхронный?"}).json()
    [comment] = edited["comments"]
    assert comment["text"] == "Почему вызов синхронный?"
    assert comment["edited_at"] is not None
    # Тот же текст — не правка.
    assert client.patch(comment_path, json={"text": "Почему вызов синхронный?"}).json() == edited


def test_who_deletes_comments_and_threads(anon_client: TestClient) -> None:
    client = anon_client
    first, second = sign_in(client), sign_in(client)
    owner = sign_in(client)
    board = new_board(client)
    share(client, board, first, "editor")
    share(client, board, second, "viewer")

    act_as(client, first)
    thread = start_thread(client, board)
    act_as(client, second)
    by_second = reply(client, thread, "Ответ второго")["comments"][1]
    act_as(client, first)
    by_first = reply(client, thread, "Ответ первого")["comments"][2]

    # Чужой ответ участник не удалит, свой — да.
    response = client.delete(f"/api/comments/{by_second['id']}")
    assert response.status_code == 403
    assert client.delete(f"/api/comments/{by_first['id']}").status_code == 204
    # Первый комментарий — это вопрос, без него обсуждения нет.
    response = client.delete(f"/api/comments/{thread['comments'][0]['id']}")
    assert response.status_code == 400
    assert response.json()["detail"] == "Первый комментарий удаляется вместе с обсуждением"

    # Тот, кто управляет доской, убирает лишнее за других.
    act_as(client, owner)
    assert client.delete(f"/api/comments/{by_second['id']}").status_code == 204
    assert [c["text"] for c in threads(client, board)[0]["comments"]] == [
        "Почему вызов синхронный?"
    ]

    act_as(client, second)
    assert client.delete(f"/api/threads/{thread['id']}").status_code == 403
    act_as(client, first)
    assert client.delete(f"/api/threads/{thread['id']}").status_code == 204
    assert threads(client, board) == []

    act_as(client, owner)
    others = start_thread(client, board)
    assert client.delete(f"/api/threads/{others['id']}").status_code == 204


def test_missing_threads_and_comments(client: TestClient) -> None:
    missing = uuid.uuid4()
    response = client.post(f"/api/threads/{missing}/comments", json={"text": "Есть кто?"})
    assert response.status_code == 404
    assert response.json()["detail"] == "Обсуждение не найдено: возможно, его удалили"
    assert client.patch(f"/api/threads/{missing}", json={"resolved": True}).status_code == 404
    assert client.delete(f"/api/comments/{missing}").status_code == 404
    assert client.patch(f"/api/comments/{missing}", json={"text": "Есть"}).status_code == 404


def test_a_deleted_board_takes_its_threads_along(client: TestClient) -> None:
    board = new_board(client)
    thread = start_thread(client, board)
    assert client.delete(f"/api/boards/{board['id']}").status_code == 204
    assert client.patch(f"/api/threads/{thread['id']}", json={"resolved": True}).status_code == 404


def changes_heard(ws: Any) -> None:
    """Ждёт сообщения «обсуждения изменились». Сообщения синхронизации пропускаются."""
    while ws.receive_bytes() != COMMENTS_CHANGED:
        pass


def test_open_boards_hear_about_every_change(client: TestClient) -> None:
    board = new_board(client)
    with client.websocket_connect(f"/ws/boards/{board['id']}") as ws:
        YClient(ws).handshake()
        thread = start_thread(client, board)
        changes_heard(ws)
        comment = reply(client, thread, "Ответ")["comments"][1]
        changes_heard(ws)
        client.patch(f"/api/comments/{comment['id']}", json={"text": "Исправленный ответ"})
        changes_heard(ws)
        client.patch(f"/api/threads/{thread['id']}", json={"resolved": True})
        changes_heard(ws)
        client.delete(f"/api/comments/{comment['id']}")
        changes_heard(ws)
        client.delete(f"/api/threads/{thread['id']}")
        changes_heard(ws)


def test_people_who_can_be_mentioned(anon_client: TestClient) -> None:
    client = anon_client
    member, stranger = sign_in(client), sign_in(client)
    admin = sign_in(client, Role.ADMIN)
    owner = sign_in(client)
    board = new_board(client)
    share(client, board, member, "viewer")

    act_as(client, member)
    people = {p["id"] for p in client.get(f"/api/boards/{board['id']}/people").json()}
    assert {owner.id, member.id, admin.id} <= people
    assert stranger.id not in people

    act_as(client, owner)
    template = client.post(f"/api/boards/{board['id']}/template", json={"name": "Шаблон"}).json()
    # Шаблон видят все, поэтому упомянуть в нём можно любого.
    act_as(client, stranger)
    people = {p["id"] for p in client.get(f"/api/boards/{template['id']}/people").json()}
    assert {owner.id, member.id, admin.id, stranger.id} <= people


def test_sql_access_rules_match_access_to(anon_client: TestClient) -> None:
    """viewable_by и people_with_access повторяют access_from в SQL: проверяем, что так и есть."""
    client = anon_client
    viewer, editor, stranger = sign_in(client), sign_in(client), sign_in(client)
    admin = sign_in(client, Role.ADMIN)
    owner = sign_in(client)
    board = new_board(client)
    share(client, board, viewer, "viewer")
    share(client, board, editor, "editor")
    template = client.post(f"/api/boards/{board['id']}/template", json={"name": "Шаблон"}).json()
    accounts: list[Account] = [owner, viewer, editor, stranger, admin]

    async def compare(db: AsyncSession) -> None:
        for board_id in (board["id"], template["id"]):
            target = await db.get(Board, uuid.UUID(board_id))
            assert target is not None
            people = {user.id for user in await people_with_access(db, target)}
            for account in accounts:
                user = await db.get(User, uuid.UUID(account.id))
                assert user is not None
                expected = await access_to(db, target, user) is not None
                visible = await db.scalar(
                    select(func.count()).where(Board.id == target.id, viewable_by(user))
                )
                assert bool(visible) == expected, (account.login, board_id)
                assert (user.id in people) == expected, (account.login, board_id)

    in_app_db(client, compare)
