import uuid
from datetime import datetime

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models import DataWipeToken


def count_for_source_since(db: Session, source_ip: str, since: datetime) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(DataWipeToken)
            .where(
                DataWipeToken.source_ip == source_ip,
                DataWipeToken.created_at > since,
            )
        )
        or 0
    )


def count_for_user_since(db: Session, user_id: uuid.UUID, since: datetime) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(DataWipeToken)
            .where(
                DataWipeToken.user_id == user_id,
                DataWipeToken.created_at > since,
            )
        )
        or 0
    )


def invalidate_active_for_user(db: Session, user_id: uuid.UUID, now: datetime) -> int:
    result = db.execute(
        update(DataWipeToken)
        .where(
            DataWipeToken.user_id == user_id,
            DataWipeToken.consumed_at.is_(None),
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
) -> DataWipeToken:
    row = DataWipeToken(
        user_id=user_id,
        token_hash=token_hash,
        source_ip=source_ip[:64],
        attempt_count=0,
        created_at=now,
        expires_at=expires_at,
    )
    db.add(row)
    db.flush()
    return row


def get_active_for_user_for_update(
    db: Session, user_id: uuid.UUID, now: datetime
) -> DataWipeToken | None:
    return db.scalar(
        select(DataWipeToken)
        .where(
            DataWipeToken.user_id == user_id,
            DataWipeToken.consumed_at.is_(None),
            DataWipeToken.expires_at > now,
        )
        .order_by(DataWipeToken.created_at.desc())
        .with_for_update()
        .limit(1)
    )


def consume(db: Session, row: DataWipeToken, now: datetime) -> None:
    row.consumed_at = now
    db.flush()


def record_failed_attempt(db: Session, row: DataWipeToken) -> int:
    row.attempt_count += 1
    db.flush()
    return row.attempt_count
