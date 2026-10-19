from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.core.config import Settings


def make_engine(settings: Settings) -> Engine:
    options: dict = {"pool_pre_ping": True}
    is_sqlite = settings.sqlalchemy_database_url.startswith("sqlite:")
    if is_sqlite:
        options["connect_args"] = {"check_same_thread": False}
    if settings.app_env == "production":
        # Short-lived serverless workers: let the provider's pooler own the connections.
        options["poolclass"] = NullPool
    engine = create_engine(settings.sqlalchemy_database_url, **options)
    if is_sqlite:
        _configure_sqlite(engine)
    return engine


def _configure_sqlite(engine: Engine) -> None:
    @event.listens_for(engine, "connect")
    def set_sqlite_pragmas(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()


def make_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False)
