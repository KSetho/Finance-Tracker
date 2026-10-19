import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.dialect import dialect_insert
from app.models import MonthlyBudget


def get_for_month(db: Session, user_id: uuid.UUID, month_start: date) -> Decimal | None:
    return db.scalar(
        select(MonthlyBudget.allowance).where(
            MonthlyBudget.user_id == user_id, MonthlyBudget.month_start == month_start
        )
    )


def upsert(
    db: Session, user_id: uuid.UUID, month_start: date, allowance: Decimal, now: datetime
) -> None:
    """One allowance per month: insert, or update the existing row (safe under concurrency)."""
    statement = dialect_insert(db, MonthlyBudget).values(
        id=uuid.uuid4(),
        user_id=user_id,
        month_start=month_start,
        allowance=allowance,
        created_at=now,
        updated_at=now,
    )
    db.execute(
        statement.on_conflict_do_update(
            index_elements=["user_id", "month_start"],
            set_={"allowance": allowance, "updated_at": now},
        )
    )


def allowances_between(
    db: Session, user_id: uuid.UUID, first: date, last: date
) -> dict[date, Decimal]:
    """Allowances for months from `first` through `last` (both first-of-month dates)."""
    rows = db.execute(
        select(MonthlyBudget.month_start, MonthlyBudget.allowance).where(
            MonthlyBudget.user_id == user_id,
            MonthlyBudget.month_start >= first,
            MonthlyBudget.month_start <= last,
        )
    )
    return {month: allowance for month, allowance in rows}
