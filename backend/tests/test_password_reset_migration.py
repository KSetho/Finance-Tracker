from alembic import command
from sqlalchemy import create_engine, inspect

from tests.conftest import _alembic_config


def test_password_reset_migration_is_portable_to_sqlite(tmp_path):
    url = f"sqlite:///{tmp_path / 'migration.db'}"
    cfg = _alembic_config(url)
    command.upgrade(cfg, "head")
    engine = create_engine(url)
    try:
        inspector = inspect(engine)
        assert "password_reset_tokens" in inspector.get_table_names()
        columns = {column["name"] for column in inspector.get_columns("password_reset_tokens")}
        assert {
            "id",
            "user_id",
            "token_hash",
            "source_ip",
            "created_at",
            "expires_at",
            "consumed_at",
        } == columns
        command.downgrade(cfg, "0002")
        assert "password_reset_tokens" not in inspect(engine).get_table_names()
    finally:
        engine.dispose()
