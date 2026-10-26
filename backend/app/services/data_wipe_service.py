"""Owner-only finance data wipe, gated by a short-lived emailed verification code."""

from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.config import Settings
from app.core.email import PasswordResetSender
from app.core.exceptions import InvalidWipeCode, ServiceUnavailable, TooManyAttempts
from app.core.security import hash_token, safe_equal
from app.models import (
    Account,
    Category,
    DataWipeToken,
    LoginAttempt,
    MonthlyBudget,
    PasswordResetToken,
    Transaction,
)
from app.repositories import data_wipe_repository, session_repository
from app.services import category_service
from app.services.auth_service import AuthContext

logger = logging.getLogger("app.data_wipe")

REQUEST_ACCEPTED_MESSAGE = "A verification code was sent to your email."
MAX_CODE = 1_000_000


def _new_code() -> str:
    return f"{secrets.randbelow(MAX_CODE):06d}"


def request_wipe(
    db: Session,
    settings: Settings,
    clock: Clock,
    sender: PasswordResetSender,
    context: AuthContext,
    *,
    source_ip: str,
) -> dict[str, str]:
    if settings.email_provider == "disabled":
        raise ServiceUnavailable("Email delivery is required to wipe data.")

    now = clock.now()
    window_start = now - timedelta(minutes=settings.data_wipe_window_minutes)
    if (
        data_wipe_repository.count_for_source_since(db, source_ip, window_start)
        >= settings.data_wipe_max_requests
        or data_wipe_repository.count_for_user_since(db, context.user_id, window_start)
        >= settings.data_wipe_max_requests
    ):
        raise TooManyAttempts(retry_after=settings.data_wipe_window_minutes * 60)

    code = _new_code()
    data_wipe_repository.invalidate_active_for_user(db, context.user_id, now)
    data_wipe_repository.create(
        db,
        user_id=context.user_id,
        token_hash=hash_token(code),
        source_ip=source_ip,
        now=now,
        expires_at=now + timedelta(minutes=settings.data_wipe_expiry_minutes),
    )
    db.flush()

    try:
        sender.send_data_wipe_code(
            context.user.email, code, settings.data_wipe_expiry_minutes
        )
    except Exception:
        db.rollback()
        logger.exception(
            "data_wipe_email_failed user_id=%s source_ip=%s", context.user_id, source_ip
        )
        raise ServiceUnavailable(
            "Could not send the verification email. Try again later."
        ) from None

    db.commit()
    logger.info("data_wipe_code_sent user_id=%s source_ip=%s", context.user_id, source_ip)
    return {"message": REQUEST_ACCEPTED_MESSAGE}


def confirm_wipe(
    db: Session,
    settings: Settings,
    clock: Clock,
    context: AuthContext,
    *,
    code: str,
) -> None:
    now = clock.now()
    row = data_wipe_repository.get_active_for_user_for_update(db, context.user_id, now)
    if row is None:
        raise InvalidWipeCode()

    if not safe_equal(row.token_hash, hash_token(code.strip())):
        attempts = data_wipe_repository.record_failed_attempt(db, row)
        if attempts >= settings.data_wipe_max_attempts:
            data_wipe_repository.consume(db, row, now)
        db.commit()
        raise InvalidWipeCode()

    data_wipe_repository.consume(db, row, now)
    _wipe_finance_data(db, context, now=now)
    db.commit()
    logger.info("data_wipe_completed user_id=%s", context.user_id)


def _wipe_finance_data(db: Session, context: AuthContext, *, now: datetime) -> None:
    user_id = context.user_id
    db.execute(delete(Transaction).where(Transaction.user_id == user_id))
    db.execute(delete(Account).where(Account.user_id == user_id))
    db.execute(delete(MonthlyBudget).where(MonthlyBudget.user_id == user_id))
    db.execute(delete(Category).where(Category.user_id == user_id))
    db.execute(delete(LoginAttempt).where(LoginAttempt.email == context.user.email))
    db.execute(delete(PasswordResetToken).where(PasswordResetToken.user_id == user_id))
    db.execute(delete(DataWipeToken).where(DataWipeToken.user_id == user_id))
    category_service.seed_defaults(db, user_id)
    session_repository.revoke_others_for_user(
        db, user_id, keep_session_id=context.session.id, now=now
    )
    db.flush()
