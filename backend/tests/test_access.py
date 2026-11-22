"""Права на доски: владелец, участники, администраторы и ссылки доступа."""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Role, ShareLink
from tests.conftest import Account, act_as, in_app_db, sign_in


def new_board(client: TestClient, name: str = "Схема") -> dict[str, Any]:
    response = client.post("/api/boards", json={"name": name})
    assert response.status_code == 201, response.text
    board: dict[str, Any] = response.json()
    return board


def share(client: TestClient, board: dict[str, Any], user: Account, role: str) -> None:
    response = client.put(f"/api/boards/{board['id']}/members/{user.id}", json={"role": role})
    assert response.status_code == 200, response.text


def board_ids(client: TestClient, query: str = "") -> list[str]:
    return [b["id"] for b in client.get(f"/api/boards{query}").json()]


def test_a_board_is_private_to_its_owner(anon_client: TestClient) -> None:
    client = anon_client
    owner = sign_in(client)
    board = new_board(client)
    assert board["access"] == "manage"
    assert board["owner"]["id"] == owner.id

    sign_in(client)
    assert board["id"] not in board_ids(client)
    response = client.get(f"/api/boards/{board['id']}")
    assert response.status_code == 403
    assert "Нет доступа" in response.json()["detail"]


def test_each_role_can_do_only_its_part(anon_client: TestClient) -> None:
    client = anon_client
    viewer, editor = sign_in(client), sign_in(client)
    owner = sign_in(client)
    board = new_board(client)
    share(client, board, viewer, "viewer")
    share(client, board, editor, "editor")
    path = f"/api/boards/{board['id']}"

    act_as(client, viewer)
    shared = next(b for b in client.get("/api/boards").json() if b["id"] == board["id"])
    assert shared["access"] == "view"
    assert shared["owner"]["id"] == owner.id
    assert client.patch(path, json={"name": "Чужое"}).status_code == 403

    act_as(client, editor)
    assert client.get(path).json()["access"] == "edit"
    assert client.patch(path, json={"name": "Правка"}).json()["name"] == "Правка"
    assert client.get(f"{path}/access").status_code == 403
    assert client.delete(path).status_code == 403

    act_as(client, owner)
    assert client.delete(path).status_code == 204


def test_admins_manage_every_board(anon_client: TestClient) -> None:
    client = anon_client
    sign_in(client)
    board = new_board(client)
    assert client.get("/api/boards?all=true").status_code == 403

    sign_in(client, Role.ADMIN)
    # В обычном списке у администратора только его доски, все — по отдельному запросу.
    assert board["id"] not in board_ids(client)
    assert board["id"] in board_ids(client, "?all=true")
    assert client.get(f"/api/boards/{board['id']}").json()["access"] == "manage"
    assert client.get(f"/api/boards/{board['id']}/access").status_code == 200


def test_owner_grants_changes_and_revokes_access(anon_client: TestClient) -> None:
    client = anon_client
    member = sign_in(client)
    owner = sign_in(client)
    board = new_board(client)
    access_path = f"/api/boards/{board['id']}/access"

    share(client, board, member, "viewer")
    share(client, board, member, "editor")
    access = client.get(access_path).json()
    assert access["owner"]["id"] == owner.id
    assert access["members"] == [
        {
            "user": {"id": member.id, "login": member.login, "name": f"Тест {member.login}"},
            "role": "editor",
        }
    ]

    assert client.delete(f"/api/boards/{board['id']}/members/{member.id}").status_code == 204
    assert client.get(access_path).json()["members"] == []
    act_as(client, member)
    assert board["id"] not in board_ids(client)


def test_access_is_given_only_to_active_colleagues(anon_client: TestClient) -> None:
    client = anon_client
    owner = sign_in(client)
    board = new_board(client)
    members = f"/api/boards/{board['id']}/members"
    assert client.put(f"{members}/{owner.id}", json={"role": "viewer"}).status_code == 400
    missing = "00000000-0000-0000-0000-000000000000"
    assert client.put(f"{members}/{missing}", json={"role": "viewer"}).status_code == 404
    assert client.put(f"{members}/{owner.id}", json={"role": "owner"}).status_code == 422

    blocked = sign_in(client)
    act_as(client, sign_in(client, Role.ADMIN))
    client.patch(f"/api/admin/users/{blocked.id}", json={"is_active": False})
    act_as(client, owner)
    assert client.put(f"{members}/{blocked.id}", json={"role": "viewer"}).status_code == 404


def test_a_link_gives_access_after_sign_in(anon_client: TestClient) -> None:
    client = anon_client
    owner = sign_in(client)
    board = new_board(client)
    links = f"/api/boards/{board['id']}/links"
    link = client.post(links, json={"role": "editor", "expires_in_days": 7}).json()
    assert link["role"] == "editor"
    assert link["expires_at"] is not None
    assert [
        x["token"] for x in client.get(f"/api/boards/{board['id']}/access").json()["links"]
    ] == [link["token"]]
    # Владелец по своей ссылке ничего не теряет и не становится участником.
    assert client.post(f"/api/links/{link['token']}/join").json()["access"] == "manage"

    guest = sign_in(client)
    joined = client.post(f"/api/links/{link['token']}/join")
    assert joined.status_code == 200
    assert joined.json()["id"] == board["id"]
    assert joined.json()["access"] == "edit"
    assert board["id"] in board_ids(client)

    act_as(client, owner)
    members = client.get(f"/api/boards/{board['id']}/access").json()["members"]
    assert [m["user"]["id"] for m in members] == [guest.id]
    assert client.delete(f"{links}/{link['token']}").status_code == 204
    act_as(client, sign_in(client))
    assert client.post(f"/api/links/{link['token']}/join").status_code == 404


def test_a_link_never_lowers_access(anon_client: TestClient) -> None:
    client = anon_client
    editor = sign_in(client)
    sign_in(client)
    board = new_board(client)
    share(client, board, editor, "editor")
    token = client.post(f"/api/boards/{board['id']}/links", json={}).json()["token"]

    act_as(client, editor)
    assert client.post(f"/api/links/{token}/join").json()["access"] == "edit"
    assert client.get(f"/api/boards/{board['id']}").json()["access"] == "edit"


def test_an_expired_link_stops_working(anon_client: TestClient) -> None:
    client = anon_client
    sign_in(client)
    board = new_board(client)
    links = f"/api/boards/{board['id']}/links"
    token = client.post(links, json={"expires_in_days": 1}).json()["token"]

    async def expire(db: AsyncSession) -> None:
        yesterday = datetime.now(UTC) - timedelta(days=1)
        await db.execute(
            update(ShareLink).where(ShareLink.token == token).values(expires_at=yesterday)
        )
        await db.commit()

    in_app_db(client, expire)
    assert client.get(f"/api/boards/{board['id']}/access").json()["links"] == []
    # Новая ссылка заодно убирает истёкшие.
    client.post(links, json={})

    sign_in(client)
    assert client.post(f"/api/links/{token}/join").status_code == 404


def test_expired_link_is_reported_as_expired(anon_client: TestClient) -> None:
    client = anon_client
    sign_in(client)
    board = new_board(client)
    token = client.post(f"/api/boards/{board['id']}/links", json={"expires_in_days": 1}).json()[
        "token"
    ]

    async def expire(db: AsyncSession) -> None:
        await db.execute(
            update(ShareLink)
            .where(ShareLink.token == token)
            .values(expires_at=datetime.now(UTC) - timedelta(minutes=1))
        )
        await db.commit()

    in_app_db(client, expire)
    sign_in(client)
    response = client.post(f"/api/links/{token}/join")
    assert response.status_code == 410
    assert "истёк" in response.json()["detail"]


def test_link_expiry_is_validated(client: TestClient) -> None:
    board = new_board(client)
    links = f"/api/boards/{board['id']}/links"
    assert client.post(links, json={"expires_in_days": 0}).status_code == 422
    assert client.post(links, json={"expires_in_days": 366}).status_code == 422
    assert client.post(links, json={"role": "owner"}).status_code == 422


def test_colleagues_directory_lists_active_users(anon_client: TestClient) -> None:
    client = anon_client
    blocked = sign_in(client)
    active = sign_in(client)
    act_as(client, sign_in(client, Role.ADMIN))
    client.patch(f"/api/admin/users/{blocked.id}", json={"is_active": False})

    act_as(client, active)
    people = client.get("/api/users").json()
    ids = [p["id"] for p in people]
    assert active.id in ids
    assert blocked.id not in ids
    assert set(people[0]) == {"id", "login", "name"}
