import uuid
from datetime import datetime

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models import PasswordResetToken


def count_for_source_since(db: Session, source_ip: str, since: datetime) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(PasswordResetToken)
            .where(
                PasswordResetToken.source_ip == source_ip,
                PasswordResetToken.created_at > since,
            )
        )
        or 0
    )


def count_for_user_since(db: Session, user_id: uuid.UUID, since: datetime) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(PasswordResetToken)
            .where(
                PasswordResetToken.user_id == user_id,
                PasswordResetToken.created_at > since,
            )
        )
        or 0
    )


def invalidate_active_for_user(db: Session, user_id: uuid.UUID, now: datetime) -> int:
    result = db.execute(
        update(PasswordResetToken)
        .where(
            PasswordResetToken.user_id == user_id,
            PasswordResetToken.consumed_at.is_(None),
        )
        .values(consumed_at=now)
    )
    return result.rowcount or 0


def create(
    db: Session,
    *,
    user_id: uuid.UUID,
    token_hash: str,
    source_ip: str,
    now: datetime,
    expires_at: datetime,
) -> PasswordResetToken:
    row = PasswordResetToken(
        user_id=user_id,
        token_hash=token_hash,
        source_ip=source_ip[:64],
        created_at=now,
        expires_at=expires_at,
    )
    db.add(row)
    db.flush()
    return row


def get_active_by_hash_for_update(
    db: Session, token_hash: str, now: datetime
) -> PasswordResetToken | None:
    return db.scalar(
        select(PasswordResetToken)
        .where(
            PasswordResetToken.token_hash == token_hash,
            PasswordResetToken.consumed_at.is_(None),
            PasswordResetToken.expires_at > now,
        )
        .with_for_update()
    )


def consume(db: Session, row: PasswordResetToken, now: datetime) -> None:
    row.consumed_at = now
    db.flush()
