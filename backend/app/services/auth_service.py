import logging
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from urllib.parse import quote

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.config import Settings, normalize_email
from app.core.email import PasswordResetSender
from app.core.exceptions import InvalidCredentials, InvalidResetToken, Unauthenticated
from app.core.security import (
    csrf_token_for,
    dummy_hash,
    hash_password,
    hash_token,
    needs_rehash,
    new_session_token,
    verify_password,
)
from app.models import Session as SessionRow
from app.models import User
from app.repositories import password_reset_repository, session_repository, user_repository
from app.services import category_service, throttle_service

logger = logging.getLogger("app.auth")


@dataclass(frozen=True)
class AuthContext:
    user: User
    session: SessionRow
    token: str

    @property
    def user_id(self) -> uuid.UUID:
        return self.user.id


@dataclass(frozen=True)
class LoginResult:
    user: User
    token: str
    csrf_token: str
    expires_at: datetime
    max_age_seconds: int


def login(
    db: Session,
    settings: Settings,
    clock: Clock,
    *,
    email: str,
    password: str,
    source_ip: str,
) -> LoginResult:
    normalized = normalize_email(email)
    now = clock.now()

    throttle_service.purge(db, settings, now)
    throttle_service.check(db, settings, now, source_ip, normalized)

    user = None
    if normalized == settings.owner_email:
        candidate = user_repository.get_by_email(db, normalized)
        if candidate is not None and candidate.is_active:
            user = candidate

    # Always exactly one verification: against a dummy hash when there is no usable owner, so
    # a wrong email costs the same as a wrong password and the response is identical.
    password_ok = verify_password(user.password_hash if user else dummy_hash(), password)
    if user is None or not password_ok:
        throttle_service.record_failure(db, now, source_ip, normalized)
        db.commit()  # keep the failure even though the request ends in an error
        logger.warning("login_failed source_ip=%s", source_ip)
        raise InvalidCredentials()

    throttle_service.clear(db, source_ip)

    if needs_rehash(user.password_hash):
        user_repository.update_password_hash(db, user, hash_password(password), now)

    session_repository.purge_expired(
        db, now=now, idle_cutoff=now - timedelta(hours=settings.session_idle_hours)
    )
    lifetime = timedelta(days=settings.session_absolute_days)
    token = new_session_token()
    row = session_repository.create(
        db, user_id=user.id, token_hash=hash_token(token), now=now, expires_at=now + lifetime
    )
    db.commit()
    logger.info("login_success user_id=%s source_ip=%s", user.id, source_ip)
    return LoginResult(
        user=user,
        token=token,
        csrf_token=csrf_token_for(token, settings.secret_key),
        expires_at=row.expires_at,
        max_age_seconds=int(lifetime.total_seconds()),
    )


LAST_SEEN_REFRESH = timedelta(minutes=5)


def validate_session(
    db: Session, settings: Settings, clock: Clock, token: str | None
) -> AuthContext:
    """Return the signed-in owner for a session token, or raise Unauthenticated."""
    if not token:
        raise Unauthenticated()
    now = clock.now()
    row = session_repository.get_by_token_hash(db, hash_token(token))
    if row is None or row.revoked_at is not None or row.expires_at <= now:
        raise Unauthenticated()
    if now - row.last_seen_at > timedelta(hours=settings.session_idle_hours):
        raise Unauthenticated()
    user = user_repository.get_by_id(db, row.user_id)
    if user is None or not user.is_active or user.email != settings.owner_email:
        raise Unauthenticated()
    if now - row.last_seen_at >= LAST_SEEN_REFRESH:
        session_repository.touch(db, row, now)
        db.commit()
    return AuthContext(user=user, session=row, token=token)


def logout(db: Session, clock: Clock, context: AuthContext) -> None:
    session_repository.revoke(db, context.session, clock.now())
    db.commit()
    logger.info("logout user_id=%s", context.user_id)


def session_response_payload(context: AuthContext, settings: Settings) -> dict:
    return {
        "user": {"id": context.user.id, "email": context.user.email},
        "csrf_token": csrf_token_for(context.token, settings.secret_key),
        "expires_at": context.session.expires_at,
    }


MIN_PASSWORD_LENGTH = 7


class OwnerAdminError(Exception):
    """An administrative owner operation was refused (shown to the administrator as-is)."""


def _validate_new_password(password: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise OwnerAdminError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")


def provision_owner(
    db: Session, settings: Settings, clock: Clock, *, email: str, password: str
) -> User:
    """Create the single owner account. Refuses a second owner or a non-owner email."""
    normalized = normalize_email(email)
    if normalized != settings.owner_email:
        raise OwnerAdminError("Email does not match OWNER_EMAIL.")
    if user_repository.count(db) > 0:
        raise OwnerAdminError("An owner already exists.")
    _validate_new_password(password)
    try:
        user = user_repository.create(
            db, email=normalized, password_hash=hash_password(password), now=clock.now()
        )
        category_service.seed_defaults(db, user.id)
        db.commit()
    except IntegrityError as exc:  # lost a race: the single-owner index rejected a second row
        db.rollback()
        raise OwnerAdminError("An owner already exists.") from exc
    return user


def reset_owner_password(db: Session, settings: Settings, clock: Clock, *, password: str) -> None:
    """Set a new owner password and end every existing session in one transaction.

    Takes no email: the account can only be reset, never re-assigned.
    """
    owner = user_repository.get_owner(db)
    if owner is None:
        raise OwnerAdminError("No owner exists. Run provision-owner first.")
    if owner.email != settings.owner_email:
        raise OwnerAdminError("Stored owner email does not match OWNER_EMAIL.")
    _validate_new_password(password)
    now = clock.now()
    user_repository.update_password_hash(db, owner, hash_password(password), now)
    session_repository.revoke_all_for_user(db, owner.id, now)
    db.commit()


def request_password_reset(
    db: Session,
    settings: Settings,
    clock: Clock,
    sender: PasswordResetSender,
    *,
    email: str,
    source_ip: str,
) -> None:
    """Create and send a single-use owner reset token, while always returning silently."""
    if not settings.password_reset_enabled:
        logger.info("password_reset_requested source_ip=%s", source_ip)
        return
    normalized = normalize_email(email)
    owner = user_repository.get_by_email(db, settings.owner_email)
    if (
        normalized != settings.owner_email
        or owner is None
        or not owner.is_active
        or password_reset_repository.count_for_source_since(
            db,
            source_ip,
            clock.now() - timedelta(minutes=settings.password_reset_window_minutes),
        )
        >= settings.password_reset_max_requests
        or password_reset_repository.count_for_user_since(
            db,
            owner.id,
            clock.now() - timedelta(minutes=settings.password_reset_window_minutes),
        )
        >= settings.password_reset_max_requests
    ):
        logger.info("password_reset_requested source_ip=%s", source_ip)
        return

    now = clock.now()
    raw_token = secrets.token_urlsafe(32)
    password_reset_repository.invalidate_active_for_user(db, owner.id, now)
    row = password_reset_repository.create(
        db,
        user_id=owner.id,
        token_hash=hash_token(raw_token),
        source_ip=source_ip,
        now=now,
        expires_at=now + timedelta(minutes=settings.password_reset_expiry_minutes),
    )
    db.commit()

    reset_url = f"{settings.frontend_origin}/reset-password?token={quote(raw_token, safe='')}"
    try:
        sender.send_password_reset(owner.email, reset_url, settings.password_reset_expiry_minutes)
        logger.info("password_reset_sent user_id=%s source_ip=%s", owner.id, source_ip)
    except Exception as exc:
        # Delivery failures are intentionally hidden from the caller and the raw token is never
        # logged. Invalidate the unsent token so it cannot remain usable.
        password_reset_repository.consume(db, row, clock.now())
        db.commit()
        logger.warning(
            "password_reset_delivery_failed source_ip=%s error_type=%s",
            source_ip,
            type(exc).__name__,
        )


def reset_password_with_token(
    db: Session,
    settings: Settings,
    clock: Clock,
    *,
    token: str,
    password: str,
) -> None:
    if not settings.password_reset_enabled:
        raise InvalidResetToken()
    _validate_new_password(password)
    now = clock.now()
    row = password_reset_repository.get_active_by_hash_for_update(db, hash_token(token), now)
    if row is None:
        raise InvalidResetToken()
    owner = user_repository.get_by_id(db, row.user_id)
    if owner is None or not owner.is_active:
        raise InvalidResetToken()

    user_repository.update_password_hash(db, owner, hash_password(password), now)
    password_reset_repository.consume(db, row, now)
    session_repository.revoke_all_for_user(db, owner.id, now)
    db.commit()
    logger.info("password_reset_completed user_id=%s", owner.id)
