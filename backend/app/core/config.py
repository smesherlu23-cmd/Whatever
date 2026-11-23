"""Настройки приложения: единственное место, где бэкенд читает окружение.

Значения приходят из переменных окружения, а при разработке вне Docker ещё и из файла .env
в корне репозитория. Полный список с пояснениями — в .env.example; тест test_config следит,
чтобы список не расходился с этим классом.

Настройки читаются в точках входа (create_app, команды app.cli, миграции) и дальше передаются
явно, через app.state и параметры конструкторов, поэтому остальной код от окружения не зависит.
"""

from datetime import timedelta
from enum import StrEnum
from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL

# backend/app/core/config.py → корень репозитория. В образе Docker такого файла нет,
# и настройки приходят только из окружения контейнера.
ROOT_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


class LogFormat(StrEnum):
    TEXT = "text"
    """Строки для чтения глазами: docker compose logs."""
    JSON = "json"
    """Одна JSON-запись на строку: для сборщиков журналов (Loki, ELK, Vector)."""


class LogLevel(StrEnum):
    DEBUG = "DEBUG"
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"


PositiveInt = Annotated[int, Field(gt=0)]


class Settings(BaseSettings):
    """Все параметры бэкенда. Переменная окружения — WHATEVER_<ИМЯ_ПОЛЯ>, кроме POSTGRES_*.

    Параметры базы данных называются так же, как у официального образа postgres: один
    и тот же пароль из .env получают и сервер базы, и бэкенд.
    """

    model_config = SettingsConfigDict(
        env_prefix="WHATEVER_",
        env_file=ROOT_ENV_FILE,
        env_file_encoding="utf-8",
        # В .env лежат и переменные compose и nginx (WHATEVER_PORT и др.): бэкенду они не нужны.
        extra="ignore",
        frozen=True,
        validate_by_name=True,
    )

    # ---------- База данных ----------

    postgres_host: str = Field("localhost", alias="POSTGRES_HOST")
    postgres_port: PositiveInt = Field(5432, alias="POSTGRES_PORT")
    postgres_user: str = Field("whatever", alias="POSTGRES_USER")
    postgres_password: SecretStr = Field(alias="POSTGRES_PASSWORD", min_length=1)
    postgres_db: str = Field("whatever", alias="POSTGRES_DB")
    db_pool_size: PositiveInt = 5
    """Постоянные соединения с базой. Сверх них открывается до db_max_overflow временных."""
    db_max_overflow: Annotated[int, Field(ge=0)] = 10

    # ---------- HTTP ----------

    forwarded_allow_ips: str = "127.0.0.1"
    """Адреса прокси, чьим заголовкам X-Forwarded-For можно верить. По ним защита от подбора
    пароля узнаёт адрес пользователя. Через запятую; «*» — любой источник."""
    cookie_secure: bool = False
    """Включите, если приложение открывают по HTTPS: cookie сессии не уйдёт по HTTP."""

    # ---------- Вход ----------

    session_ttl_days: PositiveInt = 30
    """Сколько дней действует вход без повторного ввода пароля. Срок продлевается при работе."""
    login_max_failures: PositiveInt = 5
    """Неудачных попыток входа для пары «адрес + логин», после которых вход временно закрыт."""
    login_max_failures_per_address: PositiveInt = 30
    """Неудачных попыток входа с одного адреса (по любым логинам), после которых вход с него
    временно закрыт. Защищает от перебора паролей ко многим учётным записям сразу."""
    login_window_minutes: PositiveInt = 15

    # ---------- Синхронизация досок ----------

    sync_save_delay_seconds: Annotated[float, Field(gt=0, le=10)] = 0.5
    """Изменения доски за это время пишутся в базу одной строкой."""
    sync_compact_after: PositiveInt = 50
    """Сколько записей истории доски копить, прежде чем сжать их в один снимок."""

    # ---------- История версий ----------

    version_interval_minutes: PositiveInt = 10
    """Пока доску меняют, её версия сохраняется сама раз в столько минут, а ещё когда все
    участники с неё ушли."""
    version_retention_days: PositiveInt = 30
    """Сколько дней хранятся автоматические версии. Названные хранятся, пока их не удалят."""

    # ---------- Файлы ----------

    files_dir: Path = Path("data/files")
    """Каталог картинок и вложений досок. Относительный путь считается от рабочего каталога
    процесса. В docker compose здесь том files-data, и путь задан в docker-compose.yml."""
    max_upload_mb: PositiveInt = 10
    """Наибольший размер одного файла, загружаемого на доску, в мегабайтах."""

    # ---------- Журнал ----------

    log_level: LogLevel = LogLevel.INFO
    log_format: LogFormat = LogFormat.TEXT

    @property
    def database_url(self) -> URL:
        """Адрес базы. Пароль экранируется, поэтому в нём допустимы «@», «/» и «:»."""
        return URL.create(
            "postgresql+asyncpg",
            username=self.postgres_user,
            password=self.postgres_password.get_secret_value(),
            host=self.postgres_host,
            port=self.postgres_port,
            database=self.postgres_db,
        )

    @property
    def session_ttl(self) -> timedelta:
        return timedelta(days=self.session_ttl_days)

    @property
    def login_window(self) -> timedelta:
        return timedelta(minutes=self.login_window_minutes)

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def version_interval(self) -> timedelta:
        return timedelta(minutes=self.version_interval_minutes)

    @property
    def version_retention(self) -> timedelta:
        return timedelta(days=self.version_retention_days)


@lru_cache
def get_settings() -> Settings:
    """Настройки процесса. Читаются один раз, при первом обращении."""
    return Settings()
