from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import get_settings
from app.core.db import Base
from tests.conftest import alembic_config


def test_single_migration_head() -> None:
    assert len(ScriptDirectory.from_config(alembic_config()).get_heads()) == 1


def _schema_diff(connection: Connection) -> list[object]:
    return list(compare_metadata(MigrationContext.configure(connection), Base.metadata))


async def test_models_match_migrations() -> None:
    """Схема после миграций совпадает с моделями: изменение модели без миграции не пройдёт."""
    engine = create_async_engine(get_settings().database_url)
    try:
        async with engine.connect() as connection:
            diff = await connection.run_sync(_schema_diff)
    finally:
        await engine.dispose()
    assert diff == []
