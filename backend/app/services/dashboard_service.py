import uuid
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.dates import accra_today, month_of, month_range, parse_month
from app.core.exceptions import BusinessRuleError
from app.repositories.transaction_repository import TransactionFilters
from app.schemas.dashboard import (
    CalendarDay,
    CashFlow,
    CashFlowBucket,
    CategorySpend,
    DashboardSummary,
    RecentTransactions,
    SpendingByCategory,
    TransactionCalendar,
)
from app.services import account_service, accounting, budget_service, transaction_service

MAX_RANGE_DAYS = 1100  # about three years


def _month_start(clock: Clock, month: str | None) -> date:
    try:
        return parse_month(month) if month else month_of(accra_today(clock))
    except ValueError as exc:
        raise BusinessRuleError("validation_error", str(exc)) from exc


def summary(db: Session, clock: Clock, user_id: uuid.UUID, month: str | None) -> DashboardSummary:
    first = _month_start(clock, month)
    start, end = month_range(first)
    totals = accounting.period_totals(db, user_id, start, end)
    accounts = account_service.list_accounts(db, user_id, include_archived=False)
    return DashboardSummary(
        month=f"{start.year:04d}-{start.month:02d}",
        total_income=totals.income,
        total_expenses=totals.expenses,
        fee_total=totals.fees,
        net_cash_flow=accounting.net_cash_flow(totals.income, totals.expenses),
        budget=budget_service.get_month(db, user_id, start),
        combined_balance=accounts.combined_balance,
        accounts=accounts.items,
    )


def spending_by_category(
    db: Session,
    clock: Clock,
    user_id: uuid.UUID,
    month: str | None,
    start_date: date | None,
    end_date: date | None,
) -> SpendingByCategory:
    if (start_date is None) != (end_date is None):
        raise BusinessRuleError(
            "validation_error", "Give both start_date and end_date, or neither."
        )
    if start_date is not None and end_date is not None:
        if month is not None:
            raise BusinessRuleError(
                "validation_error", "Use either month or a date range, not both."
            )
        if start_date > end_date:
            raise BusinessRuleError("validation_error", "The start date is after the end date.")
        start, end = start_date, end_date + timedelta(days=1)
    else:
        start, end = month_range(_month_start(clock, month))

    totals = accounting.spending_by_category(db, user_id, start, end)
    shares = accounting.share_percentages([t.amount for t in totals])
    return SpendingByCategory(
        total_expenses=accounting.period_totals(db, user_id, start, end).expenses,
        items=[
            CategorySpend(
                category_id=t.category_id,
                name=t.name,
                amount=t.amount,
                share_percent=format(share, "f"),
            )
            for t, share in zip(totals, shares, strict=True)
        ],
    )


def cash_flow(
    db: Session,
    user_id: uuid.UUID,
    start_date: date,
    end_date: date,
    category_id: uuid.UUID | None,
) -> CashFlow:
    if start_date > end_date:
        raise BusinessRuleError("validation_error", "The start date is after the end date.")
    if (end_date - start_date).days + 1 > MAX_RANGE_DAYS:
        raise BusinessRuleError("validation_error", "Choose a range of three years or less.")
    result = accounting.cash_flow(db, user_id, start_date, end_date, category_id)
    return CashFlow(
        group_by=result.group_by,
        income=result.income,
        expenses=result.expenses,
        net=result.net,
        buckets=[
            CashFlowBucket(period=b.period, income=b.income, expenses=b.expenses)
            for b in result.buckets
        ],
    )


def transaction_calendar(
    db: Session, clock: Clock, user_id: uuid.UUID, month: str | None
) -> TransactionCalendar:
    start, end = month_range(_month_start(clock, month))
    return TransactionCalendar(
        month=f"{start.year:04d}-{start.month:02d}",
        days=[
            CalendarDay(
                date=day.date.isoformat(),
                income=day.income,
                expenses=day.expenses,
                net=day.net,
                transaction_count=day.transaction_count,
            )
            for day in accounting.transaction_calendar(db, user_id, start, end)
        ],
    )


def recent_transactions(db: Session, user_id: uuid.UUID, limit: int) -> RecentTransactions:
    page = transaction_service.list_transactions(
        db, user_id, TransactionFilters(), "transaction_date", "desc", 1, limit
    )
    return RecentTransactions(items=page.items)
