from fastapi.testclient import TestClient

from app import __version__
from app.core.config import get_settings
from app.main import create_app


def test_health_reports_database_ok(anon_client: TestClient) -> None:
    response = anon_client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok", "version": __version__}


def test_health_fails_when_the_database_is_unreachable() -> None:
    # Порт 1 не слушает никто: соединение отклоняется сразу.
    unreachable = get_settings().model_copy(update={"postgres_port": 1})
    with TestClient(create_app(unreachable)) as client:
        response = client.get("/api/health")
    assert response.status_code == 503
    assert response.json() == {
        "status": "degraded",
        "database": "unavailable",
        "version": __version__,
    }
