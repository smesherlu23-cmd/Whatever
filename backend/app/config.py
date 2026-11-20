from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Настройки приложения. Читаются из переменных окружения с префиксом WHATEVER_."""

    model_config = SettingsConfigDict(env_prefix="WHATEVER_", env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://whatever:whatever@localhost:5432/whatever"
    redis_url: str = "redis://localhost:6379/0"
    debug: bool = False
    # Сколько дней действует вход без повторного ввода пароля. Срок продлевается при работе.
    session_ttl_days: int = 30
    # Включите, если приложение открывается по HTTPS: cookie сессии не уйдёт по HTTP.
    cookie_secure: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
