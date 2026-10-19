"""Another owner's rows must be unreachable. The product has one owner, so a second user row is
created directly (the single-owner index is lifted inside the test database only)."""

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

from app.core.security import hash_password
from app.models import (
    Account,
    AccountType,
    Category,
    Transaction,
    TransactionType,
    User,
)
from app.services import category_service

ACCOUNTS = "/api/v1/accounts"
TX = "/api/v1/transactions"
TRANSFERS = "/api/v1/transfers"


@pytest.fixture
def other(db, allow_second_user, auth_client, worked_example):
    now = datetime(2026, 10, 1, tzinfo=UTC)
    user = User(
        email="other@example.com",
        password_hash=hash_password("x" * 20),
        created_at=now,
        updated_at=now,
    )
    db.add(user)
    db.flush()
    category_service.seed_defaults(db, user.id)
    bank = Account(
        user_id=user.id,
        name="Theirs",
        account_type=AccountType.bank,
        opening_balance=Decimal("100.00"),
        opening_date=date(2026, 10, 1),
        created_at=now,
        updated_at=now,
    )
    cash = Account(
        user_id=user.id,
        name="Their cash",
        account_type=AccountType.cash,
        opening_balance=Decimal("0.00"),
        opening_date=date(2026, 10, 1),
        created_at=now,
        updated_at=now,
    )
    db.add_all([bank, cash])
    db.flush()
    food = db.query(Category).filter_by(user_id=user.id, name="Food").one()
    expense = Transaction(
        user_id=user.id,
        type=TransactionType.expense,
        name="Theirs",
        amount=Decimal("9.00"),
        transaction_date=date(2026, 10, 2),
        account_id=bank.id,
        category_id=food.id,
        created_at=now,
        updated_at=now,
    )
    transfer = Transaction(
        user_id=user.id,
        type=TransactionType.transfer,
        name="Their transfer",
        amount=Decimal("20.00"),
        transaction_date=date(2026, 10, 3),
        account_id=bank.id,
        destination_account_id=cash.id,
        fee_amount=Decimal("1.00"),
        created_at=now,
        updated_at=now,
    )
    db.add_all([expense, transfer])
    db.flush()
    fee = Transaction(
        id=uuid.uuid5(transfer.id, "fee"),
        user_id=user.id,
        type=TransactionType.expense,
        name="Fee: Their transfer",
        amount=Decimal("1.00"),
        transaction_date=date(2026, 10, 3),
        account_id=bank.id,
        category_id=db.query(Category).filter_by(user_id=user.id, name="Fees").one().id,
        related_transaction_id=transfer.id,
        created_at=now,
        updated_at=now,
    )
    db.add(fee)
    db.commit()
    return {
        "bank": bank,
        "cash": cash,
        "expense": expense,
        "transfer": transfer,
        "fee": fee,
        "food": food,
    }


def test_their_accounts_are_invisible(auth_client, other):
    mine = {
        a["name"]
        for a in auth_client.get(ACCOUNTS, params={"include_archived": "true"}).json()["items"]
    }
    assert mine == {"Bank", "MoMo", "Cash"}
    for method, suffix, body in (
        ("get", "", None),
        ("patch", "", {"name": "mine now"}),
        ("post", "/archive", None),
    ):
        response = getattr(auth_client, method)(
            f"{ACCOUNTS}/{other['bank'].id}{suffix}", **({"json": body} if body else {})
        )
        assert response.status_code == 404, (method, response.text)


def test_their_transactions_are_invisible(auth_client, other):
    for key in ("expense", "transfer", "fee"):
        target = other[key].id
        assert auth_client.get(f"{TX}/{target}").status_code == 404
        assert (
            auth_client.patch(f"{TX}/{target}", json={"version": 1, "name": "x"}).status_code == 404
        )
        assert auth_client.delete(f"{TX}/{target}").status_code == 404
    transfer = other["transfer"].id
    assert auth_client.get(f"{TRANSFERS}/{transfer}").status_code == 404
    assert (
        auth_client.patch(f"{TRANSFERS}/{transfer}", json={"version": 1, "name": "x"}).status_code
        == 404
    )
    assert auth_client.delete(f"{TRANSFERS}/{transfer}").status_code == 404
    assert auth_client.get(TX).json()["total"] == 0


def test_creating_with_their_account_or_category_is_refused(auth_client, other):
    mine = {a["name"]: a["id"] for a in auth_client.get(ACCOUNTS).json()["items"]}
    my_food = next(
        c["id"]
        for c in auth_client.get("/api/v1/categories").json()["items"]
        if c["name"] == "Food"
    )
    base = {"name": "x", "amount": "1.00", "transaction_date": "2026-10-05"}
    cases = [
        (f"{TX}/expenses", {**base, "account_id": str(other["bank"].id), "category_id": my_food}),
        (
            f"{TX}/expenses",
            {**base, "account_id": mine["Bank"], "category_id": str(other["food"].id)},
        ),
        (
            f"{TX}/expenses",
            {
                **base,
                "account_id": mine["Bank"],
                "category_id": my_food,
                "fee_amount": "1.00",
                "fee_account_id": str(other["bank"].id),
            },
        ),
        (f"{TX}/income", {**base, "account_id": str(other["bank"].id)}),
        (
            TRANSFERS,
            {
                **base,
                "source_account_id": mine["Bank"],
                "destination_account_id": str(other["bank"].id),
            },
        ),
        (
            TRANSFERS,
            {
                **base,
                "source_account_id": str(other["bank"].id),
                "destination_account_id": mine["Bank"],
            },
        ),
    ]
    for url, body in cases:
        response = auth_client.post(url, json=body)
        assert response.status_code == 404, (url, response.text)
    assert auth_client.get(TX).json()["total"] == 0


def test_editing_my_entry_to_point_at_their_account_is_refused(auth_client, other):
    mine = {a["name"]: a["id"] for a in auth_client.get(ACCOUNTS).json()["items"]}
    my_food = next(
        c["id"]
        for c in auth_client.get("/api/v1/categories").json()["items"]
        if c["name"] == "Food"
    )
    created = auth_client.post(
        f"{TX}/expenses",
        json={
            "name": "x",
            "amount": "1.00",
            "transaction_date": "2026-10-05",
            "account_id": mine["Bank"],
            "category_id": my_food,
        },
    ).json()
    response = auth_client.patch(
        f"{TX}/{created['id']}", json={"version": 1, "account_id": str(other["bank"].id)}
    )
    assert response.status_code == 404


def test_lists_and_reports_never_include_their_data(auth_client, other):
    assert len(auth_client.get("/api/v1/categories").json()["items"]) == 13
    summary = auth_client.get("/api/v1/dashboard/summary", params={"month": "2026-10"}).json()
    assert summary["total_expenses"] == "0.00" and summary["fee_total"] == "0.00"
    assert summary["combined_balance"] == "2300.00"
    spending = auth_client.get(
        "/api/v1/dashboard/spending-by-category", params={"month": "2026-10"}
    ).json()
    assert spending["items"] == []
    recent = auth_client.get("/api/v1/dashboard/recent-transactions").json()["items"]
    assert recent == []
    assert auth_client.get("/api/v1/budgets/2026/10").json()["total_expenses"] == "0.00"
