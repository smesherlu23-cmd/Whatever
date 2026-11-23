"""Показатели для Prometheus. Доступны только с токеном WHATEVER_METRICS_TOKEN."""

import hmac
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Request, Response, status

from app.auth.dependencies import AppSettings
from app.core.metrics import Metrics

router = APIRouter(tags=["service"])


@router.get("/metrics", include_in_schema=False)
async def metrics(
    request: Request,
    settings: AppSettings,
    authorization: Annotated[str, Header()] = "",
) -> Response:
    """Без настроенного токена адреса как будто нет: о показателях никто не должен узнать."""
    if settings.metrics_token is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    expected = f"Bearer {settings.metrics_token.get_secret_value()}"
    if not hmac.compare_digest(authorization.encode(), expected.encode()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, headers={"WWW-Authenticate": "Bearer"})
    collected: Metrics = request.app.state.metrics
    body, content_type = collected.render()
    return Response(body, media_type=content_type)
