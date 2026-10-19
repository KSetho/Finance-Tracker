import io

import pytest
from sqlalchemy import select

from app import cli
from app.core.config import get_settings
from app.core.security import verify_password
from app.models import Session as SessionRow
from app.models import User
from tests.conftest import OWNER_EMAIL, OWNER_PASSWORD

NEW_PASSWORD = "a brand new passphrase 42"


@pytest.fixture
def run(settings, session_factory, clock, capsys):
    def runner(argv, password=None, **kwargs):
        stdin = io.StringIO(f"{password}\n") if password is not None else None
        code = cli.main(
            argv,
            settings=kwargs.pop("settings", settings),
            session_factory=session_factory,
            clock=clock,
            stdin=stdin,
        )
        captured = capsys.readouterr()
        return code, captured.out, captured.err

    return runner


def users(db):
    db.expire_all()
    return db.scalars(select(User)).all()


# ---- provision-owner -------------------------------------------------------------------


def test_provision_creates_exactly_one_owner_with_argon2id_hash(run, db):
    code, out, err = run(
        ["provision-owner", "--email", "  Owner@Example.com ", "--password-stdin"], OWNER_PASSWORD
    )
    assert code == 0
    rows = users(db)
    assert len(rows) == 1
    assert rows[0].email == OWNER_EMAIL
    assert rows[0].password_hash.startswith("$argon2id$")
    assert OWNER_PASSWORD not in rows[0].password_hash
    assert OWNER_PASSWORD not in out + err


def test_provision_seeds_the_default_categories_once(run, db):
    from sqlalchemy import func

    from app.models import Category
    from app.services import category_service

    run(["provision-owner", "--email", OWNER_EMAIL, "--password-stdin"], OWNER_PASSWORD)
    owner = users(db)[0]
    count = lambda: db.scalar(select(func.count()).select_from(Category))  # noqa: E731
    assert count() == 13
    category_service.seed_defaults(db, owner.id)
    db.commit()
    assert count() == 13


def test_provision_interactive_prompts_twice(run, db, monkeypatch):
    answers = iter([OWNER_PASSWORD, OWNER_PASSWORD])
    monkeypatch.setattr(cli.getpass, "getpass", lambda *_a, **_k: next(answers))
    code, _, _ = run(["provision-owner", "--email", OWNER_EMAIL])
    assert code == 0
    assert len(users(db)) == 1


def test_provision_refuses_mismatched_confirmation(run, db, monkeypatch):
    answers = iter([OWNER_PASSWORD, "something else entirely"])
    monkeypatch.setattr(cli.getpass, "getpass", lambda *_a, **_k: next(answers))
    code, _, err = run(["provision-owner", "--email", OWNER_EMAIL])
    assert code == 1
    assert "match" in err.lower()
    assert users(db) == []


def test_second_provision_is_refused(run, db):
    run(["provision-owner", "--email", OWNER_EMAIL, "--password-stdin"], OWNER_PASSWORD)
    code, _, err = run(
        ["provision-owner", "--email", OWNER_EMAIL, "--password-stdin"], OWNER_PASSWORD
    )
    assert code == 1
    assert "An owner already exists." in err
    assert len(users(db)) == 1


def test_provision_refuses_email_that_is_not_owner_email(run, db):
    code, _, err = run(
        ["provision-owner", "--email", "other@example.com", "--password-stdin"], OWNER_PASSWORD
    )
    assert code == 1
    assert "Email does not match OWNER_EMAIL." in err
    assert users(db) == []


@pytest.mark.parametrize("password", ["short", "123456", ""])
def test_provision_refuses_short_passwords(run, db, password):
    code, _, err = run(["provision-owner", "--email", OWNER_EMAIL, "--password-stdin"], password)
    assert code == 1
    assert "at least 7 characters" in err
    assert users(db) == []


def test_provision_accepts_seven_character_password(run, db):
    code, _, err = run(["provision-owner", "--email", OWNER_EMAIL, "--password-stdin"], "1234567")
    assert code == 0
    assert err == ""
    assert len(users(db)) == 1


def test_invalid_configuration_exits_2(session_factory, monkeypatch, tmp_path, capsys):
    monkeypatch.chdir(tmp_path)  # no stray .env
    monkeypatch.setenv("OWNER_EMAIL", "definitely not an email")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@localhost/db")
    monkeypatch.setenv("SECRET_KEY", "k" * 48)
    get_settings.cache_clear()
    try:
        code = cli.main(
            ["provision-owner", "--email", "x@example.com", "--password-stdin"],
            session_factory=session_factory,
            stdin=io.StringIO(OWNER_PASSWORD + "\n"),
        )
    finally:
        get_settings.cache_clear()
    assert code == 2
    err = capsys.readouterr().err
    assert "owner_email" in err.lower()
    assert "k" * 48 not in err  # configuration errors must not echo secrets


# ---- reset-owner-password ----------------------------------------------------------------


def test_reset_updates_hash_and_revokes_every_session(run, make_owner, client, db):
    make_owner()
    client.post("/api/v1/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD})
    assert client.get("/api/v1/auth/me").status_code == 200

    code, out, err = run(["reset-owner-password", "--password-stdin"], NEW_PASSWORD)

    assert code == 0
    assert NEW_PASSWORD not in out + err
    assert client.get("/api/v1/auth/me").status_code == 401
    db.expire_all()
    assert all(row.revoked_at is not None for row in db.scalars(select(SessionRow)).all())
    owner = users(db)[0]
    assert verify_password(owner.password_hash, NEW_PASSWORD)
    assert not verify_password(owner.password_hash, OWNER_PASSWORD)
    old = client.post("/api/v1/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD})
    new = client.post("/api/v1/auth/login", json={"email": OWNER_EMAIL, "password": NEW_PASSWORD})
    assert old.status_code == 401
    assert new.status_code == 200


def test_reset_refuses_when_no_owner_exists(run):
    code, _, err = run(["reset-owner-password", "--password-stdin"], NEW_PASSWORD)
    assert code == 1
    assert "No owner exists. Run provision-owner first." in err


def test_reset_refuses_when_stored_email_differs_from_owner_email(run, make_owner, db):
    make_owner(email="other@example.com")
    before = users(db)[0].password_hash
    code, _, err = run(["reset-owner-password", "--password-stdin"], NEW_PASSWORD)
    assert code == 1
    assert "Stored owner email does not match OWNER_EMAIL." in err
    assert users(db)[0].password_hash == before


def test_reset_refuses_short_password_and_changes_nothing(run, make_owner, db):
    make_owner()
    before = users(db)[0].password_hash
    code, _, err = run(["reset-owner-password", "--password-stdin"], "short")
    assert code == 1
    assert "at least 7 characters" in err
    assert users(db)[0].password_hash == before


def test_reset_takes_no_email_argument(run):
    with pytest.raises(SystemExit):
        run(["reset-owner-password", "--email", "attacker@example.com", "--password-stdin"], "x")


def test_cli_logs_contain_no_passwords(run, make_owner, caplog):
    import logging

    caplog.set_level(logging.DEBUG)
    run(["reset-owner-password", "--password-stdin"], "short")  # refused
    make_owner()
    run(["reset-owner-password", "--password-stdin"], NEW_PASSWORD)
    logged = "\n".join(record.getMessage() for record in caplog.records)
    assert NEW_PASSWORD not in logged
    assert "short" not in logged
    assert "owner_password_reset" in logged
