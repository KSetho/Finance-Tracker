"""The single place that adds up money.

Balances, period totals, category totals and cash flow are all computed here, so the account,
budget, dashboard and history figures can never disagree (constitution principle II). Services and
routes call these functions; nothing else sums money.
"""

import uuid
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session

from app.db.dialect import month_bucket
from app.models import Account, Category, Transaction, TransactionType

ZERO = Decimal("0.00")


def account_balances(
    db: Session, user_id: uuid.UUID, account_ids: set[uuid.UUID] | None = None
) -> dict[uuid.UUID, Decimal]:
    """opening_balance + income - expenses (fees included) - transfers out + transfers in."""
    movement = case(
        (
            and_(
                Transaction.account_id == Account.id,
                Transaction.type == TransactionType.income,
            ),
            Transaction.amount,
        ),
        (
            and_(
                Transaction.account_id == Account.id,
                Transaction.type.in_([TransactionType.expense, TransactionType.transfer]),
            ),
            -Transaction.amount,
        ),
        (
            and_(
                Transaction.destination_account_id == Account.id,
                Transaction.type == TransactionType.transfer,
            ),
            Transaction.amount,
        ),
        else_=0,
    )
    query = (
        select(
            Account.id,
            Account.opening_balance + func.coalesce(func.sum(movement), 0),
        )
        .select_from(Account)
        .outerjoin(
            Transaction,
            or_(
                Transaction.account_id == Account.id,
                Transaction.destination_account_id == Account.id,
            ),
        )
        .where(Account.user_id == user_id)
        .group_by(Account.id, Account.opening_balance)
    )
    if account_ids is not None:
        query = query.where(Account.id.in_(account_ids))
    return {account_id: Decimal(balance) for account_id, balance in db.execute(query)}


def combined_balance(db: Session, user_id: uuid.UUID) -> Decimal:
    """Total of the balances of all active (not archived) accounts."""
    active = set(
        db.scalars(
            select(Account.id).where(Account.user_id == user_id, Account.is_archived.is_(False))
        )
    )
    balances = account_balances(db, user_id, active)
    return sum(balances.values(), ZERO)


@dataclass(frozen=True)
class PeriodTotals:
    income: Decimal
    expenses: Decimal  # every expense row, linked fee expenses included
    fees: Decimal  # the linked fee expenses alone: a subset of `expenses`


def period_totals(db: Session, user_id: uuid.UUID, start: date, end: date) -> PeriodTotals:
    """Totals for transactions dated in [start, end). Transfers and opening balances are not
    counted; a fee is counted once, through its own expense row, never through `fee_amount`."""
    row = db.execute(
        select(
            func.coalesce(
                func.sum(
                    case((Transaction.type == TransactionType.income, Transaction.amount), else_=0)
                ),
                0,
            ),
            func.coalesce(
                func.sum(
                    case((Transaction.type == TransactionType.expense, Transaction.amount), else_=0)
                ),
                0,
            ),
            func.coalesce(
                func.sum(
                    case(
                        (
                            and_(
                                Transaction.type == TransactionType.expense,
                                Transaction.related_transaction_id.is_not(None),
                            ),
                            Transaction.amount,
                        ),
                        else_=0,
                    )
                ),
                0,
            ),
        ).where(
            Transaction.user_id == user_id,
            Transaction.transaction_date >= start,
            Transaction.transaction_date < end,
        )
    ).one()
    return PeriodTotals(*(Decimal(value).quantize(ZERO) for value in row))


def monthly_expenses(
    db: Session, user_id: uuid.UUID, start: date, end: date
) -> dict[date, Decimal]:
    """Expenses per calendar month for [start, end), keyed by the first day of the month."""
    month = month_bucket(db, Transaction.transaction_date)
    rows = db.execute(
        select(month, func.sum(Transaction.amount))
        .where(
            Transaction.user_id == user_id,
            Transaction.type == TransactionType.expense,
            Transaction.transaction_date >= start,
            Transaction.transaction_date < end,
        )
        .group_by(month)
    )
    return {first: Decimal(total).quantize(ZERO) for first, total in rows}


def allowance_remaining(allowance: Decimal | None, spent: Decimal) -> Decimal | None:
    """Allowance minus spending; negative when over. None when no allowance is set."""
    return None if allowance is None else allowance - spent


def percentage_used(allowance: Decimal | None, spent: Decimal) -> Decimal | None:
    """Spending as a percentage of the allowance (two decimals); None when it is zero or unset."""
    if allowance is None or allowance <= 0:
        return None
    return (spent / allowance * 100).quantize(ZERO, rounding=ROUND_HALF_UP)


def net_cash_flow(income: Decimal, expenses: Decimal) -> Decimal:
    """Income minus expenses. Transfers and opening balances are in neither."""
    return income - expenses


@dataclass(frozen=True)
class CategoryTotal:
    category_id: uuid.UUID | None
    name: str
    amount: Decimal


def spending_by_category(
    db: Session, user_id: uuid.UUID, start: date, end: date
) -> list[CategoryTotal]:
    """Expense rows only, grouped by category (a linked fee lands in Fees), for [start, end)."""
    total = func.sum(Transaction.amount)
    rows = db.execute(
        select(Category.id, func.coalesce(Category.name, "Uncategorized"), total)
        .select_from(Transaction)
        .outerjoin(Category, Category.id == Transaction.category_id)
        .where(
            Transaction.user_id == user_id,
            Transaction.type == TransactionType.expense,
            Transaction.transaction_date >= start,
            Transaction.transaction_date < end,
        )
        .group_by(Category.id, Category.name)
        .order_by(total.desc(), Category.name)
    )
    return [CategoryTotal(cid, name, Decimal(amount).quantize(ZERO)) for cid, name, amount in rows]


def share_percentages(amounts: list[Decimal]) -> list[Decimal]:
    """Each amount's share of the total as a two-decimal percentage; the shares add up to exactly
    100.00 (largest-remainder rounding). All zeros when the total is zero."""
    total = sum(amounts, ZERO)
    if total <= 0:
        return [ZERO for _ in amounts]
    exact = [amount * 10000 / total for amount in amounts]  # hundredths of a percent
    floors = [int(value) for value in exact]
    leftover = 10000 - sum(floors)
    by_fraction = sorted(range(len(exact)), key=lambda i: (exact[i] - floors[i], -i), reverse=True)
    for index in by_fraction[:leftover]:
        floors[index] += 1
    return [(Decimal(value) / 100).quantize(ZERO) for value in floors]


@dataclass(frozen=True)
class CashFlowBucket:
    period: str  # YYYY-MM-DD for days, YYYY-MM for months
    income: Decimal
    expenses: Decimal


@dataclass(frozen=True)
class CashFlowResult:
    group_by: str
    income: Decimal
    expenses: Decimal
    net: Decimal
    buckets: list[CashFlowBucket]


@dataclass(frozen=True)
class CalendarDay:
    date: date
    income: Decimal
    expenses: Decimal
    net: Decimal
    transaction_count: int


def transaction_calendar(
    db: Session, user_id: uuid.UUID, start: date, end: date
) -> list[CalendarDay]:
    """Daily ledger activity for every date in [start, end).

    Transfers count as activity but contribute zero to income and expenses. Linked fee expense
    rows count and contribute exactly once, like every other expense row.
    """
    rows = db.execute(
        select(
            Transaction.transaction_date,
            func.coalesce(
                func.sum(
                    case((Transaction.type == TransactionType.income, Transaction.amount), else_=0)
                ),
                0,
            ),
            func.coalesce(
                func.sum(
                    case((Transaction.type == TransactionType.expense, Transaction.amount), else_=0)
                ),
                0,
            ),
            func.count(Transaction.id),
        )
        .where(
            Transaction.user_id == user_id,
            Transaction.transaction_date >= start,
            Transaction.transaction_date < end,
        )
        .group_by(Transaction.transaction_date)
    )
    found = {
        day: (Decimal(income).quantize(ZERO), Decimal(expenses).quantize(ZERO), int(count))
        for day, income, expenses, count in rows
    }

    days: list[CalendarDay] = []
    cursor = start
    while cursor < end:
        income, expenses, count = found.get(cursor, (ZERO, ZERO, 0))
        days.append(
            CalendarDay(
                date=cursor,
                income=income,
                expenses=expenses,
                net=income - expenses,
                transaction_count=count,
            )
        )
        cursor += timedelta(days=1)
    return days


def cash_flow(
    db: Session,
    user_id: uuid.UUID,
    first: date,
    last: date,
    category_id: uuid.UUID | None = None,
) -> CashFlowResult:
    """Income versus expenses between two dates (both inclusive). Ranges of up to 31 days are
    grouped by day, longer ones by month; buckets with no activity are zero."""
    by_day = (last - first).days + 1 <= 31
    if by_day:
        bucket = Transaction.transaction_date
    else:
        bucket = month_bucket(db, Transaction.transaction_date)
    query = (
        select(
            bucket,
            func.coalesce(
                func.sum(
                    case((Transaction.type == TransactionType.income, Transaction.amount), else_=0)
                ),
                0,
            ),
            func.coalesce(
                func.sum(
                    case((Transaction.type == TransactionType.expense, Transaction.amount), else_=0)
                ),
                0,
            ),
        )
        .where(
            Transaction.user_id == user_id,
            Transaction.transaction_date >= first,
            Transaction.transaction_date <= last,
            Transaction.type != TransactionType.transfer,
        )
        .group_by(bucket)
    )
    if category_id is not None:
        query = query.where(Transaction.category_id == category_id)
    found = {
        key: (Decimal(i).quantize(ZERO), Decimal(e).quantize(ZERO))
        for key, i, e in db.execute(query)
    }

    keys: list[date] = []
    cursor = first if by_day else first.replace(day=1)
    while cursor <= last:
        keys.append(cursor)
        cursor = cursor + timedelta(days=1) if by_day else _next_month(cursor)

    buckets = [
        CashFlowBucket(
            period=key.isoformat() if by_day else f"{key.year:04d}-{key.month:02d}",
            income=found.get(key, (ZERO, ZERO))[0],
            expenses=found.get(key, (ZERO, ZERO))[1],
        )
        for key in keys
    ]
    income = sum((b.income for b in buckets), ZERO)
    expenses = sum((b.expenses for b in buckets), ZERO)
    return CashFlowResult(
        "day" if by_day else "month", income, expenses, income - expenses, buckets
    )


def _next_month(value: date) -> date:
    return date(value.year + 1, 1, 1) if value.month == 12 else date(value.year, value.month + 1, 1)
