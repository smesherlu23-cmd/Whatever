"""Журнал приложения и uvicorn: один формат, один поток (stderr), уровень из настроек.

Конфигурация передаётся uvicorn при запуске (app.cli serve), поэтому сообщения самого сервера,
доступа к API и приложения выглядят одинаково с первой строки.
"""

import json
import logging
from datetime import UTC, datetime
from typing import Any

from app.core.config import LogFormat, LogLevel

# Шумные библиотеки, которым достаточно предупреждений даже при DEBUG приложения.
_QUIET_LOGGERS = ("sqlalchemy.engine", "asyncio")


class JsonFormatter(logging.Formatter):
    """Одна запись — одна строка JSON с временем в UTC."""

    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "time": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry, ensure_ascii=False)


def logging_config(level: LogLevel, fmt: LogFormat) -> dict[str, Any]:
    """Конфигурация для logging.config.dictConfig и параметра log_config у uvicorn."""
    return {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            LogFormat.TEXT.value: {"format": "%(asctime)s %(levelname)-7s %(name)s: %(message)s"},
            LogFormat.JSON.value: {"()": JsonFormatter},
        },
        "handlers": {
            "stderr": {
                "class": "logging.StreamHandler",
                "formatter": fmt.value,
                "stream": "ext://sys.stderr",
            },
        },
        "root": {"handlers": ["stderr"], "level": level.value},
        "loggers": {
            # Логгеры uvicorn по умолчанию пишут сами; здесь они передают записи корневому.
            **{
                name: {"handlers": [], "level": level.value, "propagate": True}
                for name in ("uvicorn", "uvicorn.error", "uvicorn.access")
            },
            **{name: {"level": LogLevel.WARNING.value} for name in _QUIET_LOGGERS},
        },
    }
