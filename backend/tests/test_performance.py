"""SC-009: about a year of daily use (1,500 transactions) must still feel instant."""

import random
import time
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select

from app.models import Account, Category, Transaction, TransactionType

BUDGET_SECONDS = 2.0


def test_the_dashboard_and_history_stay_fast_with_a_years_data(
    auth_client, owner, make_account, db
):
    accounts = [
        make_account(n, t, "1000.00", date(2025, 1, 1))
        for n, t in (("Bank", "bank"), ("MoMo", "mobile_money"), ("Cash", "cash"))
    ]
    expense_cats = db.scalars(select(Category).where(Category.category_type == "expense")).all()
    income_cat = db.scalars(select(Category).where(Category.name == "Salary")).one()
    fees = next(c for c in expense_cats if c.name == "Fees")
    rng = random.Random(7)
    now = datetime(2026, 10, 1, tzinfo=UTC)
    rows = []
    for i in range(1500):
        when = date(2025, 11, 1) + timedelta(days=rng.randint(0, 340))
        kind = rng.choices(["expense", "income", "transfer"], weights=[70, 15, 15])[0]
        source, other = rng.sample(accounts, 2)
        base = dict(
            id=uuid.uuid4(),
            user_id=owner.id,
            name=f"row {i}",
            transaction_date=when,
            amount=Decimal(rng.randint(100, 50000)) / 100,
            created_at=now,
            updated_at=now,
        )
        if kind == "expense":
            rows.append(
                Transaction(
                    type=TransactionType.expense,
                    account_id=source.id,
                    category_id=rng.choice(expense_cats).id,
                    **base,
                )
            )
        elif kind == "income":
            rows.append(
                Transaction(
                    type=TransactionType.income,
                    account_id=source.id,
                    category_id=income_cat.id,
                    **base,
                )
            )
        else:
            parent = Transaction(
                type=TransactionType.transfer,
                account_id=source.id,
                destination_account_id=other.id,
                fee_amount=Decimal("1.00"),
                **base,
            )
            rows.append(parent)
            rows.append(
                Transaction(
                    id=uuid.uuid5(parent.id, "fee"),
                    user_id=owner.id,
                    type=TransactionType.expense,
                    name="Fee",
                    amount=Decimal("1.00"),
                    transaction_date=when,
                    account_id=source.id,
                    category_id=fees.id,
                    related_transaction_id=parent.id,
                    created_at=now,
                    updated_at=now,
                )
            )
    db.add_all(rows)
    db.commit()

    paths = [
        ("/api/v1/dashboard/summary", {"month": "2026-06"}),
        ("/api/v1/dashboard/spending-by-category", {"month": "2026-06"}),
        ("/api/v1/dashboard/cash-flow", {"start_date": "2026-01-01", "end_date": "2026-06-30"}),
        ("/api/v1/dashboard/recent-transactions", {}),
        ("/api/v1/budgets", {}),
        ("/api/v1/transactions", {"page_size": 20}),
    ]
    started = time.perf_counter()
    for path, params in paths:
        response = auth_client.get(path, params=params)
        assert response.status_code == 200, (path, response.text)
    elapsed = time.perf_counter() - started
    assert elapsed < BUDGET_SECONDS, f"took {elapsed:.2f}s for {len(paths)} requests"
    assert len(db.scalars(select(Account)).all()) == 3
