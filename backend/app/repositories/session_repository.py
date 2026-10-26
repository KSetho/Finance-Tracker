import uuid
from datetime import datetime

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session as DbSession

from app.models import Session


def create(
    db: DbSession, *, user_id: uuid.UUID, token_hash: str, now: datetime, expires_at: datetime
) -> Session:
    row = Session(
        user_id=user_id,
        token_hash=token_hash,
        created_at=now,
        last_seen_at=now,
        expires_at=expires_at,
    )
    db.add(row)
    db.flush()
    return row


def get_by_token_hash(db: DbSession, token_hash: str) -> Session | None:
    return db.scalar(select(Session).where(Session.token_hash == token_hash))


def touch(db: DbSession, session: Session, now: datetime) -> None:
    session.last_seen_at = now
    db.flush()


def revoke(db: DbSession, session: Session, now: datetime) -> None:
    if session.revoked_at is None:
        session.revoked_at = now
        db.flush()


def revoke_all_for_user(db: DbSession, user_id: uuid.UUID, now: datetime) -> int:
    result = db.execute(
        update(Session)
        .where(Session.user_id == user_id, Session.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    return result.rowcount or 0


def revoke_others_for_user(
    db: DbSession, user_id: uuid.UUID, *, keep_session_id: uuid.UUID, now: datetime
) -> int:
    result = db.execute(
        update(Session)
        .where(
            Session.user_id == user_id,
            Session.revoked_at.is_(None),
            Session.id != keep_session_id,
        )
        .values(revoked_at=now)
    )
    return result.rowcount or 0


def purge_expired(db: DbSession, *, now: datetime, idle_cutoff: datetime) -> int:
    """Delete rows that can never be valid again (revoked, absolutely expired, or idle too long)."""
    result = db.execute(
        delete(Session).where(
            (Session.revoked_at.is_not(None))
            | (Session.expires_at <= now)
            | (Session.last_seen_at <= idle_cutoff)
        )
    )
    return result.rowcount or 0
