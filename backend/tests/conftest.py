import os
import uuid
from collections.abc import Callable, Iterator
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings
from app.core.security import hash_password
from app.models import Account, AccountType, User
from app.services import category_service

BACKEND_DIR = Path(__file__).resolve().parent.parent
ADMIN_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://finance:finance@localhost:5433/finance"
)

OWNER_EMAIL = "owner@example.com"
OWNER_PASSWORD = "correct horse battery staple"
FRONTEND_ORIGIN = "http://localhost:5173"
SECRET_KEY = "test-secret-key-" + "x" * 40


class FakeClock:
    def __init__(self, start: datetime | None = None):
        self._now = start or datetime(2026, 10, 17, 12, 0, 0, tzinfo=UTC)

    def now(self) -> datetime:
        return self._now

    def advance(self, **kwargs: float) -> None:
        self._now += timedelta(**kwargs)


def _alembic_config(url: str) -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    cfg.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
    return cfg


@pytest.fixture(scope="session")
def test_database_url() -> Iterator[str]:
    """Throwaway PostgreSQL database with the Alembic schema applied."""
    name = f"finance_test_{uuid.uuid4().hex[:12]}"
    admin = create_engine(ADMIN_DATABASE_URL, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{name}"'))
    url = make_url(ADMIN_DATABASE_URL).set(database=name).render_as_string(hide_password=False)
    command.upgrade(_alembic_config(url), "head")
    try:
        yield url
    finally:
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


@pytest.fixture(scope="session")
def engine(test_database_url: str) -> Iterator[Engine]:
    eng = create_engine(test_database_url)
    yield eng
    eng.dispose()


@pytest.fixture
def clean_db(engine: Engine) -> Iterator[None]:
    yield
    with engine.begin() as conn:
        conn.execute(
            text(
                "TRUNCATE users, sessions, login_attempts, password_reset_tokens, "
                "accounts, categories, "
                "transactions, monthly_budgets CASCADE"
            )
        )


@pytest.fixture
def settings(test_database_url: str) -> Settings:
    return Settings(
        _env_file=None,
        owner_email=OWNER_EMAIL,
        database_url=test_database_url,
        secret_key=SECRET_KEY,
        frontend_origin=FRONTEND_ORIGIN,
        app_env="test",
        password_reset_enabled=True,
        email_provider="smtp",
    )


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def db(engine: Engine, clean_db: None) -> Iterator[Session]:
    with Session(engine, expire_on_commit=False) as session:
        yield session


@pytest.fixture
def session_factory(engine: Engine, clean_db: None) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False)


@pytest.fixture
def make_client(
    settings: Settings, clock: FakeClock, clean_db: None
) -> Iterator[Callable[..., TestClient]]:
    from app.main import create_app

    clients: list[TestClient] = []

    def factory(**setting_overrides) -> TestClient:
        effective = settings.model_copy(update=setting_overrides)
        client = TestClient(
            create_app(settings=effective, clock=clock), headers={"Origin": FRONTEND_ORIGIN}
        )
        clients.append(client)
        return client

    yield factory
    for client in clients:
        client.close()


@pytest.fixture
def client(make_client: Callable[..., TestClient]) -> TestClient:
    return make_client()


@pytest.fixture
def make_owner(db: Session, clock: FakeClock) -> Callable[..., User]:
    def factory(
        email: str = OWNER_EMAIL, password: str = OWNER_PASSWORD, is_active: bool = True
    ) -> User:
        user = User(
            email=email,
            password_hash=hash_password(password),
            is_active=is_active,
            created_at=clock.now(),
            updated_at=clock.now(),
        )
        db.add(user)
        db.flush()
        category_service.seed_defaults(db, user.id)
        db.commit()
        return user

    return factory


@pytest.fixture
def make_account(db: Session, clock: FakeClock) -> Callable[..., Account]:
    def factory(
        name: str,
        account_type: str = "bank",
        opening_balance: str = "0.00",
        opening_date: date = date(2026, 10, 1),
        user: User | None = None,
    ) -> Account:
        owner = user or db.scalars(select(User)).first()
        assert owner is not None, "create the owner first (make_owner)"
        account = Account(
            user_id=owner.id,
            name=name,
            account_type=AccountType(account_type),
            opening_balance=Decimal(opening_balance),
            opening_date=opening_date,
            created_at=clock.now(),
            updated_at=clock.now(),
        )
        db.add(account)
        db.commit()
        return account

    return factory


@pytest.fixture
def owner(make_owner) -> User:
    return make_owner()


@pytest.fixture
def auth_client(client: TestClient, owner: User) -> TestClient:
    """A client signed in as the owner, with the CSRF header set for state-changing calls."""
    response = client.post(
        "/api/v1/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}
    )
    assert response.status_code == 200, response.text
    client.headers["X-CSRF-Token"] = response.json()["csrf_token"]
    return client


@pytest.fixture
def worked_example(owner, make_account) -> dict:
    """Owner plus Bank 2,000.00, MoMo 300.00 and Cash 0.00 (opening 2026-10-01)."""
    return {
        "owner": owner,
        "bank": make_account("Bank", "bank", "2000.00"),
        "momo": make_account("MoMo", "mobile_money", "300.00"),
        "cash": make_account("Cash", "cash", "0.00"),
    }


@pytest.fixture
def allow_second_user(engine: Engine, clean_db: None) -> Iterator[None]:
    """Lift the single-owner index so ownership tests can create a second user row."""
    with engine.begin() as conn:
        conn.execute(text("DROP INDEX IF EXISTS users_single_owner"))
    yield
    with engine.begin() as conn:
        conn.execute(
            text(
                "TRUNCATE users, sessions, login_attempts, password_reset_tokens, "
                "accounts, categories, "
                "transactions, monthly_budgets CASCADE"
            )
        )
        conn.execute(text("CREATE UNIQUE INDEX users_single_owner ON users ((true))"))
