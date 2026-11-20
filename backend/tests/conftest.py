import os
import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest

_db_dir = tempfile.mkdtemp(prefix="whatever-tests-")
os.environ["WHATEVER_DATABASE_URL"] = f"sqlite+aiosqlite:///{_db_dir}/test.db"

from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from alembic import command  # noqa: E402
from app.main import create_app  # noqa: E402

BACKEND = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session", autouse=True)
def migrated_database() -> None:
    """Тестовая база создаётся настоящими миграциями, так что они тоже проверяются."""
    command.upgrade(Config(str(BACKEND / "alembic.ini")), "head")


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(create_app()) as c:
        yield c
