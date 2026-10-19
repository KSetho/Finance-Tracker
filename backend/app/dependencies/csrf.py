from urllib.parse import urlsplit

from fastapi import Depends, Header, Request

from app.core.config import Settings
from app.core.exceptions import CsrfFailed, OriginNotAllowed
from app.core.security import csrf_token_for, safe_equal
from app.dependencies.auth import current_owner
from app.dependencies.settings import get_app_settings
from app.services.auth_service import AuthContext

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def _request_origin(request: Request) -> str | None:
    origin = request.headers.get("origin")
    if origin:
        return origin.lower()
    referer = request.headers.get("referer")
    if referer:
        parts = urlsplit(referer)
        if parts.scheme and parts.netloc:
            return f"{parts.scheme}://{parts.netloc}".lower()
    return None


def require_trusted_origin(
    request: Request, settings: Settings = Depends(get_app_settings)
) -> None:
    """Reject state-changing requests that do not come from the configured frontend origin."""
    if request.method in SAFE_METHODS:
        return
    if _request_origin(request) != settings.frontend_origin.lower():
        raise OriginNotAllowed()


def require_csrf(
    request: Request,
    context: AuthContext = Depends(current_owner),
    settings: Settings = Depends(get_app_settings),
    x_csrf_token: str | None = Header(default=None),
) -> None:
    """Synchronizer token bound to the session (HMAC of the session token)."""
    if request.method in SAFE_METHODS:
        return
    expected = csrf_token_for(context.token, settings.secret_key)
    if not x_csrf_token or not safe_equal(x_csrf_token, expected):
        raise CsrfFailed()
