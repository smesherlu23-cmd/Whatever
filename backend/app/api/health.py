"""Проверка готовности: на неё смотрят healthcheck Docker и мониторинг."""

import asyncio
import logging
from typing import Literal

from fastapi import APIRouter, Response, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app import __version__
from app.core.db import DbSession

log = logging.getLogger(__name__)

router = APIRouter(tags=["service"])

# Зависшая база не должна подвешивать и проверку: healthcheck ждёт ответа считанные секунды.
DATABASE_TIMEOUT_SECONDS = 2


class Health(BaseModel):
    status: Literal["ok", "degraded"]
    database: Literal["ok", "unavailable"]
    # Какая версия установлена: её спрашивают первой, когда что-то пошло не так.
    version: str = __version__


@router.get(
    "/health",
    responses={status.HTTP_503_SERVICE_UNAVAILABLE: {"model": Health}},
)
async def health(session: DbSession, response: Response) -> Health:
    """200, если сервис работает и база отвечает; 503, если база недоступна."""
    try:
        async with asyncio.timeout(DATABASE_TIMEOUT_SECONDS):
            await session.execute(text("SELECT 1"))
    except (SQLAlchemyError, OSError):
        # OSError включает TimeoutError и отказ в соединении до того, как ответит драйвер.
        log.warning("health check: database is unavailable", exc_info=True)
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return Health(status="degraded", database="unavailable")
    return Health(status="ok", database="ok")
