import uuid
from datetime import UTC, datetime, timedelta

import pytest
from alembic import command
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from tests.conftest import _alembic_config


def _insert_user(conn, email="owner@example.com"):
    conn.execute(
        text("INSERT INTO users (id, email, password_hash) VALUES (:id, :email, 'hash')"),
        {"id": uuid.uuid4(), "email": email},
    )


def test_tables_exist(engine, clean_db):
    tables = set(inspect(engine).get_table_names())
    assert {"users", "sessions", "login_attempts"} <= tables


def test_second_user_is_rejected_by_single_owner_index(engine, clean_db):
    with engine.begin() as conn:
        _insert_user(conn, "owner@example.com")
    with pytest.raises(IntegrityError), engine.begin() as conn:
        _insert_user(conn, "other@example.com")


def test_email_must_be_normalized(engine, clean_db):
    with pytest.raises(IntegrityError), engine.begin() as conn:
        _insert_user(conn, " Owner@Example.com ")


def test_duplicate_token_hash_rejected(engine, clean_db):
    user_id = uuid.uuid4()
    expires = datetime.now(UTC) + timedelta(days=1)
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO users (id, email, password_hash) VALUES (:id, 'o@example.com', 'h')"),
            {"id": user_id},
        )
        conn.execute(
            text(
                "INSERT INTO sessions (id, user_id, token_hash, expires_at) "
                "VALUES (:id, :uid, 'dup', :exp)"
            ),
            {"id": uuid.uuid4(), "uid": user_id, "exp": expires},
        )
    with pytest.raises(IntegrityError), engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO sessions (id, user_id, token_hash, expires_at) "
                "VALUES (:id, :uid, 'dup', :exp)"
            ),
            {"id": uuid.uuid4(), "uid": user_id, "exp": expires},
        )


def test_deleting_user_cascades_to_sessions(engine, clean_db):
    user_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO users (id, email, password_hash) VALUES (:id, 'o@example.com', 'h')"),
            {"id": user_id},
        )
        conn.execute(
            text(
                "INSERT INTO sessions (id, user_id, token_hash, expires_at) "
                "VALUES (:id, :uid, 't', now())"
            ),
            {"id": uuid.uuid4(), "uid": user_id},
        )
        conn.execute(text("DELETE FROM users WHERE id = :id"), {"id": user_id})
        assert conn.execute(text("SELECT count(*) FROM sessions")).scalar_one() == 0


def test_downgrade_then_upgrade_round_trip(test_database_url, clean_db):
    cfg = _alembic_config(test_database_url)
    command.downgrade(cfg, "base")
    eng = create_engine(test_database_url)
    try:
        assert "users" not in inspect(eng).get_table_names()
    finally:
        eng.dispose()
    command.upgrade(cfg, "head")
    eng = create_engine(test_database_url)
    try:
        assert {"users", "sessions", "login_attempts"} <= set(inspect(eng).get_table_names())
    finally:
        eng.dispose()
