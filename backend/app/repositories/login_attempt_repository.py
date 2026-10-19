from datetime import datetime

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import LoginAttempt


def add(db: Session, *, source_ip: str, email: str, now: datetime) -> None:
    db.add(LoginAttempt(source_ip=source_ip, email=email[:320], attempted_at=now))
    db.flush()


def count_for_ip_since(db: Session, source_ip: str, since: datetime) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(LoginAttempt)
            .where(LoginAttempt.source_ip == source_ip, LoginAttempt.attempted_at > since)
        )
        or 0
    )


def count_for_email_since(db: Session, email: str, since: datetime) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(LoginAttempt)
            .where(LoginAttempt.email == email[:320], LoginAttempt.attempted_at > since)
        )
        or 0
    )


def oldest_for_ip_since(db: Session, source_ip: str, since: datetime) -> datetime | None:
    return db.scalar(
        select(func.min(LoginAttempt.attempted_at)).where(
            LoginAttempt.source_ip == source_ip, LoginAttempt.attempted_at > since
        )
    )


def oldest_for_email_since(db: Session, email: str, since: datetime) -> datetime | None:
    return db.scalar(
        select(func.min(LoginAttempt.attempted_at)).where(
            LoginAttempt.email == email[:320], LoginAttempt.attempted_at > since
        )
    )


def delete_for_ip(db: Session, source_ip: str) -> None:
    db.execute(delete(LoginAttempt).where(LoginAttempt.source_ip == source_ip))


def purge_before(db: Session, cutoff: datetime) -> None:
    db.execute(delete(LoginAttempt).where(LoginAttempt.attempted_at <= cutoff))
