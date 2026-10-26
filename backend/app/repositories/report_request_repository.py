import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import ReportRequest


def count_for_user_since(db: Session, user_id: uuid.UUID, since: datetime) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(ReportRequest)
            .where(
                ReportRequest.user_id == user_id,
                ReportRequest.created_at > since,
            )
        )
        or 0
    )


def count_for_source_since(db: Session, source_ip: str, since: datetime) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(ReportRequest)
            .where(
                ReportRequest.source_ip == source_ip,
                ReportRequest.created_at > since,
            )
        )
        or 0
    )


def create(
    db: Session, *, user_id: uuid.UUID, source_ip: str, now: datetime
) -> ReportRequest:
    row = ReportRequest(
        user_id=user_id,
        source_ip=source_ip[:64],
        created_at=now,
    )
    db.add(row)
    db.flush()
    return row
