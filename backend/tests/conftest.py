"""Общие фикстуры. Тесты работают с настоящим PostgreSQL, как и рабочий сервер.

Подключение берётся из тех же переменных POSTGRES_*, что и у приложения, но база отдельная —
<POSTGRES_DB>_test. Её пересоздают при каждом запуске, поэтому данные разработки не пострадают.
Файлы досок тесты пишут во временный каталог, который удаляется после запуска.
"""

import asyncio
import os
import shutil
import tempfile
import uuid
from collections.abc import Awaitable, Callable, Iterator
from dataclasses import dataclass
from pathlib import Path

import pytest
from alembic.config import Config
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from alembic import command
from app.auth.passwords import hash_password
from app.core.config import Settings, get_settings
from app.core.db import Database
from app.main import create_app
from app.models import Role, User

BACKEND = Path(__file__).resolve().parents[1]
PASSWORD = "correct-horse-battery"


FILES_DIR = pytest.StashKey[Path]()


def pytest_configure(config: pytest.Config) -> None:
    """Переключает настройки на тестовую базу и временный каталог файлов до того,
    как их прочтёт приложение."""
    try:
        settings = Settings()
    except ValidationError as error:
        raise pytest.UsageError(
            "Тестам нужен PostgreSQL: задайте POSTGRES_PASSWORD и при необходимости "
            "POSTGRES_HOST в окружении или в .env (см. .env.example и make db)"
        ) from error
    os.environ["POSTGRES_DB"] = f"{settings.postgres_db}_test"
    files = Path(tempfile.mkdtemp(prefix="whatever-files-"))
    config.stash[FILES_DIR] = files
    os.environ["WHATEVER_FILES_DIR"] = str(files)
    get_settings.cache_clear()


def pytest_unconfigure(config: pytest.Config) -> None:
    files = config.stash.get(FILES_DIR, None)
    if files is not None:
        shutil.rmtree(files, ignore_errors=True)


async def _recreate_database(settings: Settings) -> None:
    # CREATE и DROP DATABASE не выполняются внутри транзакции, отсюда AUTOCOMMIT.
    engine = create_async_engine(
        settings.database_url.set(database="postgres"), isolation_level="AUTOCOMMIT"
    )
    name = engine.dialect.identifier_preparer.quote(settings.postgres_db)
    try:
        async with engine.connect() as connection:
            await connection.execute(text(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)"))
            await connection.execute(text(f"CREATE DATABASE {name}"))
    except OSError as error:
        pytest.exit(f"PostgreSQL недоступен ({error}). Запустите его: make db", returncode=2)
    finally:
        await engine.dispose()


def alembic_config() -> Config:
    config = Config(str(BACKEND / "alembic.ini"))
    # Журнал в тестах настраивает pytest.
    config.attributes["configure_logging"] = False
    return config


@pytest.fixture(scope="session", autouse=True)
def migrated_database() -> None:
    """Тестовая база создаётся настоящими миграциями, так что они тоже проверяются."""
    asyncio.run(_recreate_database(get_settings()))
    command.upgrade(alembic_config(), "head")


def in_app_db[T](client: TestClient, work: Callable[[AsyncSession], Awaitable[T]]) -> T:
    """Выполняет work с сессией базы приложения в его цикле событий.

    Пул соединений привязан к циклу приложения, поэтому из цикла теста им пользоваться нельзя.
    """
    app = client.app
    assert isinstance(app, FastAPI)
    database: Database = app.state.database

    async def run() -> T:
        async with database.sessions() as db:
            return await work(db)

    assert client.portal is not None
    return client.portal.call(run)


def create_user(
    client: TestClient, role: Role = Role.USER, *, active: bool = True, password: str = PASSWORD
) -> str:
    """Создаёт пользователя напрямую в базе и возвращает его логин."""
    login = f"user-{uuid.uuid4().hex[:8]}"

    async def create(db: AsyncSession) -> None:
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

    in_app_db(client, create)
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
