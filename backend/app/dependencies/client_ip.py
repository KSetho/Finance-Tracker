from fastapi import Depends, Request

from app.core.config import Settings
from app.dependencies.settings import get_app_settings


def client_ip(request: Request, settings: Settings = Depends(get_app_settings)) -> str:
    """Source address used for throttling.

    The forwarded header is attacker-controlled unless a trusted proxy sets it, so it is only
    honoured when TRUSTED_PROXY is enabled.
    """
    if settings.trusted_proxy:
        forwarded = request.headers.get("x-forwarded-for", "")
        first = forwarded.split(",")[0].strip()
        if first:
            return first[:64]
    return request.client.host if request.client else "unknown"
