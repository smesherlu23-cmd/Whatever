import json
import logging
import sys

from app.core.config import LogFormat, LogLevel
from app.core.logging import JsonFormatter, SkipHealthChecks, logging_config


def test_json_records_are_single_line_with_exception() -> None:
    try:
        raise ValueError("сломалось")
    except ValueError:
        record = logging.LogRecord(
            "app.test", logging.ERROR, __file__, 1, "доска %s", ("b1",), None
        )
        record.exc_info = sys.exc_info()
    line = JsonFormatter().format(record)

    assert "\n" not in line
    entry = json.loads(line)
    assert entry["level"] == "ERROR"
    assert entry["logger"] == "app.test"
    assert entry["message"] == "доска b1"
    assert "ValueError: сломалось" in entry["exception"]
    assert entry["time"].endswith("+00:00")


def test_uvicorn_logs_go_through_the_same_handler() -> None:
    config = logging_config(LogLevel.DEBUG, LogFormat.JSON)
    assert config["handlers"]["stderr"]["formatter"] == "json"
    assert config["root"]["level"] == "DEBUG"
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = config["loggers"][name]
        assert (logger["handlers"], logger["level"], logger["propagate"]) == ([], "DEBUG", True)
    # Запросы SQL не попадают в журнал даже при DEBUG.
    assert config["loggers"]["sqlalchemy.engine"]["level"] == "WARNING"


def access_record(path: str, status: int) -> logging.LogRecord:
    args = ("172.18.0.5:0", "GET", path, "1.1", status)
    return logging.LogRecord("uvicorn.access", logging.INFO, __file__, 1, "%s", args, None)


def test_only_successful_health_checks_are_dropped_from_the_access_log() -> None:
    skip = SkipHealthChecks()
    assert not skip.filter(access_record("/api/health", 200))
    assert skip.filter(access_record("/api/health", 503))
    assert skip.filter(access_record("/api/boards", 200))
