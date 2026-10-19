from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.config import Settings
from app.dependencies.db import get_db
from app.dependencies.settings import get_app_settings, get_clock
from app.services import auth_service
from app.services.auth_service import AuthContext


def current_owner(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
    clock: Clock = Depends(get_clock),
) -> AuthContext:
    token = request.cookies.get(settings.session_cookie_name)
    return auth_service.validate_session(db, settings, clock, token)
