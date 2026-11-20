from fastapi import APIRouter
from sqlalchemy import text

from app.db import DbSession

router = APIRouter(tags=["service"])


@router.get("/health")
async def health(session: DbSession) -> dict[str, str]:
    """Проверка, что сервис жив и база данных отвечает."""
    try:
        await session.execute(text("SELECT 1"))
        db = "ok"
    except Exception:
        db = "unavailable"
    return {"status": "ok" if db == "ok" else "degraded", "database": db}
