import io
import uuid

import pytest
from fastapi.testclient import TestClient

from app import cli
from app.main import create_app
from tests.conftest import log_in


def run(monkeypatch: pytest.MonkeyPatch, *args: str, password: str) -> None:
    monkeypatch.setattr("sys.stdin", io.StringIO(password + "\n"))
    cli.main(["create-admin", *args, "--password-stdin"])


def test_create_admin_then_log_in(monkeypatch: pytest.MonkeyPatch) -> None:
    login = f"admin-{uuid.uuid4().hex[:6]}"
    run(monkeypatch, login, "--name", "Главный", password="initial-password")
    with pytest.raises(SystemExit, match="уже есть"):
        run(monkeypatch, login, password="initial-password")

    with TestClient(create_app()) as client:
        log_in(client, login, "initial-password")
        assert client.get("/api/auth/me").json()["role"] == "admin"


@pytest.mark.parametrize(
    ("login", "password"), [("a", "long-enough-password"), ("valid-login", "short")]
)
def test_create_admin_validates_input(
    monkeypatch: pytest.MonkeyPatch, login: str, password: str
) -> None:
    with pytest.raises(SystemExit, match="Неверные данные"):
        run(monkeypatch, login, password=password)
