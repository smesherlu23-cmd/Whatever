from typing import Any

from fastapi.testclient import TestClient

from tests.conftest import PASSWORD, create_user, log_in


def new_user(admin: TestClient, **fields: Any) -> dict[str, Any]:
    body = {"login": "Ivanov", "name": "Иван Иванов", "password": PASSWORD} | fields
    response = admin.post("/api/admin/users", json=body)
    assert response.status_code == 201, response.text
    user: dict[str, Any] = response.json()
    return user


def test_only_admins_manage_users(client: TestClient) -> None:
    assert client.get("/api/admin/users").status_code == 403
    assert client.post("/api/admin/users", json={}).status_code == 403


def test_admin_creates_and_lists_users(admin_client: TestClient) -> None:
    user = new_user(admin_client, login=" Petrov.A ", role="admin")
    assert user["login"] == "petrov.a"
    assert user["role"] == "admin"
    assert user["is_active"] is True
    assert "password_hash" not in user
    logins = [u["login"] for u in admin_client.get("/api/admin/users").json()]
    assert "petrov.a" in logins


def test_login_must_be_unique_and_valid(admin_client: TestClient) -> None:
    new_user(admin_client, login="sidorov")
    duplicate = admin_client.post(
        "/api/admin/users", json={"login": "SIDOROV", "name": "Другой", "password": PASSWORD}
    )
    assert duplicate.status_code == 409
    for login in ["ab", "с пробелом", "кириллица"]:
        response = admin_client.post(
            "/api/admin/users", json={"login": login, "name": "X", "password": PASSWORD}
        )
        assert response.status_code == 422, login


def test_blocking_a_user_ends_their_sessions(admin_client: TestClient) -> None:
    login = create_user(admin_client)
    user_id = next(
        u["id"] for u in admin_client.get("/api/admin/users").json() if u["login"] == login
    )
    admin_cookies = dict(admin_client.cookies)

    log_in(admin_client, login)
    assert admin_client.get("/api/boards").status_code == 200
    user_cookies = dict(admin_client.cookies)

    admin_client.cookies.clear()
    admin_client.cookies.update(admin_cookies)
    blocked = admin_client.patch(f"/api/admin/users/{user_id}", json={"is_active": False})
    assert blocked.json()["is_active"] is False

    admin_client.cookies.clear()
    admin_client.cookies.update(user_cookies)
    assert admin_client.get("/api/boards").status_code == 401


def test_admin_resets_a_password_and_renames(admin_client: TestClient) -> None:
    user = new_user(admin_client, login="kuznetsov")
    updated = admin_client.patch(
        f"/api/admin/users/{user['id']}",
        json={"password": "reset-by-admin", "name": "Кузнецов К.", "role": "admin"},
    )
    assert updated.json()["name"] == "Кузнецов К."
    assert updated.json()["role"] == "admin"
    admin_client.post("/api/auth/logout")
    log_in(admin_client, "kuznetsov", "reset-by-admin")


def test_admin_cannot_lock_themselves_out(admin_client: TestClient) -> None:
    me = admin_client.get("/api/auth/me").json()
    for change in [{"is_active": False}, {"role": "user"}]:
        response = admin_client.patch(f"/api/admin/users/{me['id']}", json=change)
        assert response.status_code == 400
    assert admin_client.patch(f"/api/admin/users/{me['id']}", json={"name": "Я"}).status_code == 200


def test_unknown_user(admin_client: TestClient) -> None:
    missing = "/api/admin/users/00000000-0000-0000-0000-000000000000"
    assert admin_client.patch(missing, json={"name": "X"}).status_code == 404
