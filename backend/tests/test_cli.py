import io
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app import cli
from app.core.config import get_settings
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


def test_serve_runs_uvicorn_with_settings_from_the_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, Any]] = []
    monkeypatch.setattr("uvicorn.run", lambda app, **options: calls.append({"app": app, **options}))
    cli.main(["serve", "--host", "0.0.0.0", "--port", "9000"])

    (options,) = calls
    assert options["app"] == "app.main:create_app"
    assert options["factory"] is True
    assert (options["host"], options["port"], options["reload"]) == ("0.0.0.0", 9000, False)
    assert options["forwarded_allow_ips"] == get_settings().forwarded_allow_ips
    assert options["log_config"]["root"]["level"] == get_settings().log_level
