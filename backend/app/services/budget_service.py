import logging
import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.dates import accra_today, add_months, format_month, month_of, month_range, parse_month
from app.core.exceptions import BusinessRuleError
from app.repositories import budget_repository
from app.schemas.budget import BudgetList, BudgetSummary
from app.services import accounting

logger = logging.getLogger("app.finance")

DEFAULT_MONTHS = 12
MAX_MONTHS = 36


def _summary(month_start: date, allowance: Decimal | None, spent: Decimal) -> BudgetSummary:
    remaining = accounting.allowance_remaining(allowance, spent)
    percentage = accounting.percentage_used(allowance, spent)
    return BudgetSummary(
        month=format_month(month_start),
        allowance=allowance,
        total_expenses=spent,
        remaining=remaining,
        percentage_used=None if percentage is None else format(percentage, "f"),
        is_over_budget=remaining is not None and remaining < 0,
    )


def get_month(db: Session, user_id: uuid.UUID, month_start: date) -> BudgetSummary:
    start, end = month_range(month_start)
    spent = accounting.period_totals(db, user_id, start, end).expenses
    return _summary(start, budget_repository.get_for_month(db, user_id, start), spent)


def set_allowance(
    db: Session, clock: Clock, user_id: uuid.UUID, month_start: date, allowance: Decimal
) -> BudgetSummary:
    budget_repository.upsert(db, user_id, month_of(month_start), allowance, clock.now())
    db.commit()
    logger.info("budget_set month=%s", format_month(month_start))
    return get_month(db, user_id, month_start)


def list_months(
    db: Session, clock: Clock, user_id: uuid.UUID, first: str | None, last: str | None
) -> BudgetList:
    try:
        newest = parse_month(last) if last else month_of(accra_today(clock))
        oldest = parse_month(first) if first else add_months(newest, -(DEFAULT_MONTHS - 1))
    except ValueError as exc:
        raise BusinessRuleError("validation_error", str(exc)) from exc
    if oldest > newest:
        raise BusinessRuleError("validation_error", "The start month is after the end month.")
    count = (newest.year - oldest.year) * 12 + newest.month - oldest.month + 1
    if count > MAX_MONTHS:
        raise BusinessRuleError(
            "validation_error", f"Ask for at most {MAX_MONTHS} months at a time."
        )

    allowances = budget_repository.allowances_between(db, user_id, oldest, newest)
    spent = accounting.monthly_expenses(db, user_id, oldest, month_range(newest)[1])
    items = [
        _summary(month, allowances.get(month), spent.get(month, accounting.ZERO))
        for month in (add_months(newest, -offset) for offset in range(count))
    ]
    return BudgetList(items=items)
