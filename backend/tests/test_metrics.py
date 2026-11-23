"""Показатели для Prometheus и id запроса в журнале и ответе."""

import logging

from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.core.config import get_settings
from app.core.logging import AddRequestId, JsonFormatter
from app.core.metrics import request_id
from app.main import create_app

TOKEN = "metrics-token"


def test_metrics_are_hidden_without_a_token(anon_client: TestClient) -> None:
    assert anon_client.get("/api/metrics").status_code == 404


def test_metrics_need_the_right_token() -> None:
    settings = get_settings().model_copy(update={"metrics_token": SecretStr(TOKEN)})
    with TestClient(create_app(settings)) as client:
        assert client.get("/api/metrics").status_code == 401
        wrong = client.get("/api/metrics", headers={"Authorization": "Bearer nope"})
        assert wrong.status_code == 401

        client.get("/api/health")
        client.get("/api/boards/00000000-0000-0000-0000-000000000000")
        response = client.get("/api/metrics", headers={"Authorization": f"Bearer {TOKEN}"})
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/plain")
        text = response.text
        assert "whatever_rooms_open 0.0" in text
        assert "whatever_connections 0.0" in text
        assert 'route="/api/health",status="200"' in text
        # Путь с id доски попадает в показатели шаблоном, а не каждым id по отдельности.
        assert 'route="/api/boards/{board_id}",status="401"' in text
        assert "00000000-0000" not in text
        assert "process_cpu_seconds_total" in text


def test_every_response_carries_a_request_id(anon_client: TestClient) -> None:
    fresh = anon_client.get("/api/health").headers["X-Request-ID"]
    assert len(fresh) == 32
    assert anon_client.get("/api/health").headers["X-Request-ID"] != fresh

    from_nginx = anon_client.get("/api/health", headers={"X-Request-ID": "abc-123"})
    assert from_nginx.headers["X-Request-ID"] == "abc-123"
    # Что угодно вместо id в журнал не попадает: сервер выдаёт свой.
    forged = anon_client.get("/api/health", headers={"X-Request-ID": "a b\nc"})
    assert forged.headers["X-Request-ID"] != "a b\nc"


def test_log_records_carry_the_request_id() -> None:
    record = logging.LogRecord("app", logging.INFO, __file__, 1, "board saved", None, None)
    AddRequestId().filter(record)
    assert record.__dict__["request_id"] == "-"
    assert "request_id" not in JsonFormatter().format(record)

    token = request_id.set("abc-123")
    try:
        AddRequestId().filter(record)
        assert record.__dict__["request_id"] == "abc-123"
        assert '"request_id": "abc-123"' in JsonFormatter().format(record)
    finally:
        request_id.reset(token)
