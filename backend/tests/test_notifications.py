"""Уведомления: упоминания и ответы в обсуждениях, прочитанные и непрочитанные."""

from typing import Any

from fastapi.testclient import TestClient

from tests.conftest import Account, act_as, sign_in
from tests.test_access import new_board, share
from tests.test_comments import reply, start_thread


def inbox(client: TestClient) -> dict[str, Any]:
    response = client.get("/api/notifications")
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def kinds(client: TestClient) -> list[str]:
    return [item["kind"] for item in inbox(client)["items"]]


def team(client: TestClient, size: int) -> tuple[list[Account], dict[str, Any]]:
    """Владелец и участники доски с правом просмотра. Клиент остаётся у владельца."""
    members = [sign_in(client) for _ in range(size)]
    owner = sign_in(client)
    board = new_board(client, "Платежи")
    for member in members:
        share(client, board, member, "viewer")
    return [owner, *members], board


def test_a_mention_notifies_a_colleague_who_sees_the_board(anon_client: TestClient) -> None:
    client = anon_client
    outsider = sign_in(client)
    [owner, colleague], board = team(client, 1)
    text = f"@{colleague.login.upper()}, @{outsider.login} и @{owner.login}: кто владелец очереди?"
    thread = start_thread(client, board, text)
    # Упоминание того, кому доска не видна, остаётся просто текстом.
    mentions = thread["comments"][0]["mentions"]
    assert {p["id"] for p in mentions} == {colleague.id, owner.id}

    act_as(client, colleague)
    notifications = inbox(client)
    assert notifications["unread"] == 1
    [item] = notifications["items"]
    assert item["kind"] == "mention"
    assert item["read"] is False
    assert item["actor"]["id"] == owner.id
    assert item["board"] == {"id": board["id"], "name": "Платежи"}
    assert item["thread_id"] == thread["id"]
    assert item["comment_id"] == thread["comments"][0]["id"]
    assert item["excerpt"] == text

    act_as(client, outsider)
    assert inbox(client) == {"unread": 0, "items": []}
    # Себя не уведомляют.
    act_as(client, owner)
    assert inbox(client)["items"] == []


def test_a_reply_notifies_everyone_in_the_thread(anon_client: TestClient) -> None:
    client = anon_client
    [author, first, second], board = team(client, 2)
    thread = start_thread(client, board)
    act_as(client, first)
    reply(client, thread, "Так задумано")
    act_as(client, second)
    reply(client, thread, f"@{author.login}, а таймаут какой?")

    act_as(client, author)
    # Упоминание важнее ответа: на комментарий одно уведомление.
    assert kinds(client) == ["mention", "reply"]
    act_as(client, first)
    assert kinds(client) == ["reply"]
    act_as(client, second)
    assert kinds(client) == []


def test_long_comments_are_cut_in_notifications(anon_client: TestClient) -> None:
    client = anon_client
    [owner, colleague], board = team(client, 1)
    start_thread(client, board, f"@{colleague.login} " + "очень длинный вопрос " * 20)
    act_as(client, colleague)
    excerpt = inbox(client)["items"][0]["excerpt"]
    assert len(excerpt) == 200
    assert excerpt.endswith("…")
    assert owner.login not in excerpt


def test_an_edit_notifies_only_newly_mentioned(anon_client: TestClient) -> None:
    client = anon_client
    [owner, answerer, late], board = team(client, 2)
    thread = start_thread(client, board)
    act_as(client, answerer)
    reply(client, thread, "Первый ответ")
    act_as(client, owner)
    comment = reply(client, thread, "Спасибо")["comments"][2]
    act_as(client, answerer)
    client.post("/api/notifications/read-all")
    assert inbox(client)["unread"] == 0

    act_as(client, owner)
    path = f"/api/comments/{comment['id']}"
    edited = client.patch(path, json={"text": f"Спасибо, @{answerer.login} и @{late.login}"})
    mentions = edited.json()["comments"][2]["mentions"]
    assert {p["id"] for p in mentions} == {answerer.id, late.id}
    # Ответ, о котором уже знали, стал упоминанием и снова непрочитан.
    act_as(client, answerer)
    assert inbox(client)["unread"] == 1
    assert kinds(client) == ["mention"]
    act_as(client, late)
    assert kinds(client) == ["mention"]

    act_as(client, owner)
    client.patch(path, json={"text": f"Спасибо, @{late.login}"})
    act_as(client, late)
    client.post("/api/notifications/read-all")
    act_as(client, owner)
    client.patch(path, json={"text": f"Спасибо большое, @{late.login}"})
    act_as(client, late)
    assert inbox(client)["unread"] == 0


def test_opening_a_thread_reads_its_notifications(anon_client: TestClient) -> None:
    client = anon_client
    [owner, colleague], board = team(client, 1)
    first = start_thread(client, board, f"@{colleague.login}, глянь API")
    second = start_thread(client, board, f"@{colleague.login}, и очередь")

    act_as(client, colleague)
    assert inbox(client)["unread"] == 2
    assert client.post(f"/api/threads/{first['id']}/read").status_code == 204
    notifications = inbox(client)
    assert notifications["unread"] == 1
    assert [(i["thread_id"], i["read"]) for i in notifications["items"]] == [
        (second["id"], False),
        (first["id"], True),
    ]
    assert client.post("/api/notifications/read-all").status_code == 204
    assert inbox(client)["unread"] == 0
    act_as(client, owner)
    assert client.post(f"/api/threads/{first['id']}/read").status_code == 204


def test_notifications_follow_access_to_the_board(anon_client: TestClient) -> None:
    client = anon_client
    [owner, colleague], board = team(client, 1)
    thread = start_thread(client, board, f"@{colleague.login}, посмотри")
    act_as(client, colleague)
    assert inbox(client)["unread"] == 1

    act_as(client, owner)
    client.delete(f"/api/boards/{board['id']}/members/{colleague.id}")
    act_as(client, colleague)
    assert inbox(client) == {"unread": 0, "items": []}
    assert client.post(f"/api/threads/{thread['id']}/read").status_code == 403

    act_as(client, owner)
    share(client, board, colleague, "viewer")
    act_as(client, colleague)
    assert inbox(client)["unread"] == 1


def test_deleted_comments_take_their_notifications_along(anon_client: TestClient) -> None:
    client = anon_client
    [owner, colleague], board = team(client, 1)
    thread = start_thread(client, board)
    comment = reply(client, thread, f"@{colleague.login}, как думаешь?")["comments"][1]
    other = start_thread(client, board, f"@{colleague.login}, и тут")

    client.delete(f"/api/comments/{comment['id']}")
    act_as(client, colleague)
    assert [i["thread_id"] for i in inbox(client)["items"]] == [other["id"]]
    act_as(client, owner)
    client.delete(f"/api/boards/{board['id']}")
    act_as(client, colleague)
    assert inbox(client)["items"] == []
