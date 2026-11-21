import os
import tempfile
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pytest

_db_dir = tempfile.mkdtemp(prefix="whatever-tests-")
os.environ["WHATEVER_DATABASE_URL"] = f"sqlite+aiosqlite:///{_db_dir}/test.db"

from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from alembic import command  # noqa: E402
from app.auth.passwords import hash_password  # noqa: E402
from app.db import session_factory  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import Role, User  # noqa: E402

BACKEND = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session", autouse=True)
def migrated_database() -> None:
    """Тестовая база создаётся настоящими миграциями, так что они тоже проверяются."""
    command.upgrade(Config(str(BACKEND / "alembic.ini")), "head")


PASSWORD = "correct-horse-battery"


def create_user(
    client: TestClient, role: Role = Role.USER, *, active: bool = True, password: str = PASSWORD
) -> str:
    """Создаёт пользователя напрямую в базе и возвращает его логин."""
    login = f"user-{uuid.uuid4().hex[:8]}"

    async def create() -> None:
        async with session_factory()() as db:
            db.add(
                User(
                    login=login,
                    name=f"Тест {login}",
                    role=role,
                    is_active=active,
                    password_hash=await hash_password(password),
                )
            )
            await db.commit()

    # Запрос к базе идёт в цикле событий приложения, а не в цикле теста.
    assert client.portal is not None
    client.portal.call(create)
    return login


def log_in(client: TestClient, login: str, password: str = PASSWORD) -> None:
    response = client.post("/api/auth/login", json={"login": login, "password": password})
    assert response.status_code == 200, response.text


@dataclass(frozen=True)
class Account:
    """Вошедший пользователь: его id и cookie сессии."""

    id: str
    login: str
    cookies: dict[str, str]


def sign_in(client: TestClient, role: Role = Role.USER) -> Account:
    """Создаёт пользователя и входит под ним. Клиент остаётся в его сессии."""
    login = create_user(client, role)
    client.cookies.clear()
    log_in(client, login)
    user_id: str = client.get("/api/auth/me").json()["id"]
    return Account(user_id, login, dict(client.cookies))


def act_as(client: TestClient, account: Account) -> None:
    """Дальнейшие запросы клиента идут от имени account."""
    client.cookies.clear()
    client.cookies.update(account.cookies)


@pytest.fixture
def anon_client() -> Iterator[TestClient]:
    """Клиент без входа в систему."""
    with TestClient(create_app()) as c:
        yield c


@pytest.fixture
def client(anon_client: TestClient) -> TestClient:
    """Клиент, вошедший как обычный пользователь."""
    log_in(anon_client, create_user(anon_client))
    return anon_client


@pytest.fixture
def admin_client(anon_client: TestClient) -> TestClient:
    """Клиент, вошедший как администратор."""
    log_in(anon_client, create_user(anon_client, Role.ADMIN))
    return anon_client
