import logging
import math
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.exceptions import TooManyAttempts
from app.repositories import login_attempt_repository as attempts

logger = logging.getLogger("app.auth")


def _window(settings: Settings) -> timedelta:
    return timedelta(minutes=settings.login_window_minutes)


def check(db: Session, settings: Settings, now: datetime, source_ip: str, email: str) -> None:
    """Raise TooManyAttempts when the source IP or the owner account is over its failure limit."""
    window = _window(settings)
    since = now - window
    retry_after: list[float] = []

    if attempts.count_for_ip_since(db, source_ip, since) >= settings.login_max_failures_per_ip:
        oldest = attempts.oldest_for_ip_since(db, source_ip, since)
        if oldest is not None:
            retry_after.append((oldest + window - now).total_seconds())

    if (
        email == settings.owner_email
        and attempts.count_for_email_since(db, email, since)
        >= settings.login_max_failures_per_account
    ):
        oldest = attempts.oldest_for_email_since(db, email, since)
        if oldest is not None:
            retry_after.append((oldest + window - now).total_seconds())

    if retry_after:
        logger.warning("login_throttled source_ip=%s", source_ip)
        raise TooManyAttempts(math.ceil(max(retry_after)))


def record_failure(db: Session, now: datetime, source_ip: str, email: str) -> None:
    attempts.add(db, source_ip=source_ip, email=email, now=now)


def clear(db: Session, source_ip: str) -> None:
    attempts.delete_for_ip(db, source_ip)


def purge(db: Session, settings: Settings, now: datetime) -> None:
    attempts.purge_before(db, now - _window(settings))
