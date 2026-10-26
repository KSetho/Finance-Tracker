from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, FastAPI

from app.api import accounts as accounts_api
from app.api import auth as auth_api
from app.api import budgets as budgets_api
from app.api import categories as categories_api
from app.api import dashboard as dashboard_api
from app.api import data_wipe as data_wipe_api
from app.api import health as health_api
from app.api import reports as reports_api
from app.api import transactions as transactions_api
from app.api import transfers as transfers_api
from app.core.clock import Clock, SystemClock
from app.core.config import Settings, get_settings
from app.core.email import PasswordResetSender, make_password_reset_sender
from app.core.exceptions import install_exception_handlers
from app.core.logging import configure_logging
from app.db.session import make_engine, make_session_factory
from app.dependencies.csrf import require_trusted_origin


def create_app(
    settings: Settings | None = None,
    clock: Clock | None = None,
    password_reset_sender: PasswordResetSender | None = None,
) -> FastAPI:
    """Application factory. Run with `uvicorn app.main:create_app --factory`.

    Settings are validated here, so a missing or malformed OWNER_EMAIL stops startup instead of
    leaving the API open.
    """
    settings = settings or get_settings()
    configure_logging()
    engine = make_engine(settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        engine.dispose()

    docs = None if settings.app_env == "production" else "/docs"
    app = FastAPI(
        title="Finance Tracker API",
        docs_url=docs,
        redoc_url=None,
        openapi_url=None if docs is None else "/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.clock = clock or SystemClock()
    app.state.password_reset_sender = password_reset_sender or make_password_reset_sender(settings)
    app.state.session_factory = make_session_factory(engine)

    install_exception_handlers(app)

    api_router = APIRouter(prefix="/api/v1", dependencies=[Depends(require_trusted_origin)])
    api_router.include_router(auth_api.router)
    api_router.include_router(health_api.router)
    api_router.include_router(accounts_api.router)
    api_router.include_router(categories_api.router)
    api_router.include_router(transactions_api.router)
    api_router.include_router(transfers_api.router)
    api_router.include_router(budgets_api.router)
    api_router.include_router(dashboard_api.router)
    api_router.include_router(data_wipe_api.router)
    api_router.include_router(reports_api.router)
    app.include_router(api_router)
    return app
