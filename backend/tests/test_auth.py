from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.sessions import COOKIE_NAME
from app.core.config import get_settings
from app.models import Session
from tests.conftest import PASSWORD, create_user, in_app_db, log_in


def test_login_sets_a_protected_session_cookie(anon_client: TestClient) -> None:
    login = create_user(anon_client)
    response = anon_client.post(
        "/api/auth/login", json={"login": login.upper(), "password": PASSWORD}
    )
    assert response.status_code == 200
    assert response.json()["login"] == login
    cookie = response.headers["set-cookie"]
    assert f"{COOKIE_NAME}=" in cookie
    assert "HttpOnly" in cookie
    assert "SameSite=lax" in cookie
    assert anon_client.get("/api/auth/me").json()["login"] == login


@pytest.mark.parametrize("known_login", [True, False])
def test_wrong_credentials_look_the_same(anon_client: TestClient, known_login: bool) -> None:
    login = create_user(anon_client) if known_login else "nobody"
    response = anon_client.post("/api/auth/login", json={"login": login, "password": "wrong!"})
    assert response.status_code == 401
    assert response.json()["detail"] == "Неверный логин или пароль"


def test_blocked_user_cannot_log_in(anon_client: TestClient) -> None:
    login = create_user(anon_client, active=False)
    response = anon_client.post("/api/auth/login", json={"login": login, "password": PASSWORD})
    assert response.status_code == 403


def test_boards_and_profile_need_a_login(anon_client: TestClient) -> None:
    assert anon_client.get("/api/boards").status_code == 401
    assert anon_client.post("/api/boards", json={}).status_code == 401
    assert anon_client.get("/api/auth/me").status_code == 401
    assert anon_client.get("/api/health").status_code == 200


def test_logout_ends_the_session(client: TestClient) -> None:
    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/boards").status_code == 401


def test_password_guessing_is_slowed_down(anon_client: TestClient) -> None:
    login = create_user(anon_client)
    for _ in range(get_settings().login_max_failures):
        anon_client.post("/api/auth/login", json={"login": login, "password": "guess"})
    blocked = anon_client.post("/api/auth/login", json={"login": login, "password": PASSWORD})
    assert blocked.status_code == 429
    assert int(blocked.headers["retry-after"]) > 0


def test_changing_the_password(anon_client: TestClient) -> None:
    login = create_user(anon_client)
    log_in(anon_client, login)
    wrong = anon_client.post(
        "/api/auth/password",
        json={"current_password": "not-it", "new_password": "brand-new-password"},
    )
    assert wrong.status_code == 400
    changed = anon_client.post(
        "/api/auth/password",
        json={"current_password": PASSWORD, "new_password": "brand-new-password"},
    )
    assert changed.status_code == 204
    # Текущая вкладка остаётся в системе с новой сессией.
    assert anon_client.get("/api/auth/me").status_code == 200

    anon_client.post("/api/auth/logout")
    old = anon_client.post("/api/auth/login", json={"login": login, "password": PASSWORD})
    assert old.status_code == 401
    log_in(anon_client, login, "brand-new-password")


def test_new_password_must_be_long_enough(client: TestClient) -> None:
    response = client.post(
        "/api/auth/password", json={"current_password": PASSWORD, "new_password": "short"}
    )
    assert response.status_code == 422


def test_expired_session_is_rejected(client: TestClient) -> None:
    async def expire_all(db: AsyncSession) -> None:
        await db.execute(update(Session).values(expires_at=datetime.now(UTC) - timedelta(1)))
        await db.commit()

    in_app_db(client, expire_all)
    assert client.get("/api/boards").status_code == 401


def test_requests_from_other_sites_are_rejected(client: TestClient) -> None:
    foreign = client.post("/api/boards", json={}, headers={"Origin": "https://evil.example"})
    assert foreign.status_code == 403
    own = client.post("/api/boards", json={}, headers={"Origin": "http://testserver"})
    assert own.status_code == 201
    # Чтение не меняет данных, его Origin не проверяется.
    assert client.get("/api/boards", headers={"Origin": "https://evil.example"}).status_code == 200
