from pathlib import Path

from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine

from app.config import get_settings
from app.db import Base

BACKEND = Path(__file__).resolve().parents[1]


def test_single_migration_head() -> None:
    script = ScriptDirectory.from_config(Config(str(BACKEND / "alembic.ini")))
    assert len(script.get_heads()) == 1


def test_models_match_migrations() -> None:
    """Схема после миграций совпадает с моделями: изменение модели без миграции не пройдёт."""
    url = get_settings().database_url.replace("+aiosqlite", "")
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            diff = compare_metadata(MigrationContext.configure(connection), Base.metadata)
    finally:
        engine.dispose()
    assert diff == []
