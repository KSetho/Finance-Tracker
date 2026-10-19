import threading
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.models import Transaction, TransactionType
from app.repositories import transaction_repository
from app.services import transfer_service
from tests.conftest import FRONTEND_ORIGIN

ACCOUNTS = "/api/v1/accounts"
TX = "/api/v1/transactions"
TRANSFERS = "/api/v1/transfers"


def ids(client):
    accounts = {a["name"]: a["id"] for a in client.get(ACCOUNTS).json()["items"]}
    cats = {c["name"]: c["id"] for c in client.get("/api/v1/categories").json()["items"]}
    return accounts, cats


def balances(client):
    return {a["name"]: a["balance"] for a in client.get(ACCOUNTS).json()["items"]}


def listing(client, **params):
    return client.get(TX, params={"page_size": 100, **params}).json()["items"]


def payment(client, amount="100.00", fee="2.00", fee_account=None, **extra):
    accounts, cats = ids(client)
    body = {
        "name": "Sent to Ama",
        "amount": amount,
        "transaction_date": "2026-10-05",
        "account_id": accounts["Bank"],
        "category_id": cats["Family"],
        "fee_amount": fee,
        **extra,
    }
    if fee_account:
        body["fee_account_id"] = accounts[fee_account]
    return client.post(f"{TX}/expenses", json=body)


@pytest.fixture
def api(auth_client, worked_example):
    return auth_client


def test_a_payment_with_a_fee_creates_two_expenses(api):
    response = payment(api)
    assert response.status_code == 201
    parent = response.json()
    assert parent["fee_amount"] == "2.00"
    assert parent["fee"]["amount"] == "2.00"
    assert balances(api)["Bank"] == "1898.00"  # 100 + 2
    expenses = listing(api, type="expense")
    assert sorted(e["amount"] for e in expenses) == ["100.00", "2.00"]
    fee = next(e for e in expenses if e["is_fee"])
    assert fee["category"]["name"] == "Fees"
    assert fee["related_transaction_id"] == parent["id"]
    # the parent's fee_amount is an input; only expense rows count: 102.00 in total
    assert sum(float(e["amount"]) for e in expenses) == pytest.approx(102.00)


def test_the_fee_can_be_charged_to_another_account(api):
    payment(api, fee_account="Cash")
    assert balances(api) == {"Bank": "1900.00", "MoMo": "300.00", "Cash": "-2.00"}


def test_an_expense_without_a_fee_has_no_fee_row(api):
    assert payment(api, fee="0.00").status_code == 201
    assert len(listing(api)) == 1
    assert balances(api)["Bank"] == "1900.00"


def test_editing_the_amount_and_fee_keeps_the_pair_in_sync(api):
    parent = payment(api).json()
    response = api.patch(
        f"{TX}/{parent['id']}", json={"version": 1, "amount": "120.00", "fee_amount": "3.00"}
    )
    assert response.status_code == 200
    assert response.json()["fee"]["amount"] == "3.00"
    assert balances(api)["Bank"] == "1877.00"
    assert len([e for e in listing(api) if e["is_fee"]]) == 1


def test_removing_and_restoring_a_fee_on_an_expense(api):
    parent = payment(api).json()
    api.patch(f"{TX}/{parent['id']}", json={"version": 1, "fee_amount": "0.00"})
    assert [e for e in listing(api) if e["is_fee"]] == []
    assert balances(api)["Bank"] == "1900.00"
    api.patch(f"{TX}/{parent['id']}", json={"version": 2, "fee_amount": "2.50"})
    assert balances(api)["Bank"] == "1897.50"


def test_deleting_the_expense_deletes_its_fee(api):
    parent = payment(api).json()
    assert api.delete(f"{TX}/{parent['id']}").status_code == 204
    assert listing(api) == []
    assert balances(api)["Bank"] == "2000.00"


def test_a_fee_row_cannot_be_edited_or_deleted_on_its_own(api):
    parent = payment(api).json()
    fee_id = parent["fee"]["id"]
    patched = api.patch(f"{TX}/{fee_id}", json={"version": 1, "name": "x"})
    deleted = api.delete(f"{TX}/{fee_id}")
    assert patched.status_code == deleted.status_code == 409
    assert patched.json()["error"]["code"] == "fee_managed_by_parent"
    assert deleted.json()["error"]["code"] == "fee_managed_by_parent"
    assert api.get(f"{TRANSFERS}/{fee_id}").status_code == 404
    fetched = api.get(f"{TX}/{fee_id}").json()
    assert fetched["is_fee"] is True and fetched["related_transaction_id"] == parent["id"]
    assert balances(api)["Bank"] == "1898.00"


def test_the_database_refuses_a_second_fee_for_one_parent(api, db):
    parent = payment(api).json()
    existing = db.get(Transaction, uuid.UUID(parent["fee"]["id"]))
    duplicate = Transaction(
        user_id=existing.user_id,
        type=TransactionType.expense,
        name="dup",
        amount=existing.amount,
        transaction_date=existing.transaction_date,
        account_id=existing.account_id,
        category_id=existing.category_id,
        related_transaction_id=uuid.UUID(parent["id"]),
    )
    db.add(duplicate)
    with pytest.raises(IntegrityError):
        db.flush()
    db.rollback()


def test_a_failure_while_creating_leaves_nothing_behind(api, db, monkeypatch):
    original = transaction_repository.add
    calls = {"count": 0}

    def failing_add(session, row):
        calls["count"] += 1
        if calls["count"] == 2:  # the fee row, after the parent was inserted
            raise RuntimeError("disk on fire")
        return original(session, row)

    monkeypatch.setattr(transaction_repository, "add", failing_add)
    with pytest.raises(RuntimeError):
        payment(api)
    monkeypatch.undo()
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(Transaction)) == 0
    assert balances(api) == {"Bank": "2000.00", "MoMo": "300.00", "Cash": "0.00"}


def test_a_failure_while_editing_leaves_the_original_intact(api, monkeypatch):
    parent = payment(api).json()

    def failing_sync(*args, **kwargs):
        raise RuntimeError("disk on fire")

    monkeypatch.setattr(transfer_service, "sync_fee", failing_sync)
    with pytest.raises(RuntimeError):
        api.patch(
            f"{TX}/{parent['id']}", json={"version": 1, "amount": "500.00", "fee_amount": "9.00"}
        )
    monkeypatch.undo()
    after = api.get(f"{TX}/{parent['id']}").json()
    assert (after["amount"], after["fee_amount"], after["version"]) == ("100.00", "2.00", 1)
    assert after["fee"]["amount"] == "2.00"
    assert balances(api)["Bank"] == "1898.00"


def test_a_failure_while_deleting_leaves_everything_in_place(api, monkeypatch):
    parent = payment(api).json()

    def failing_delete(*args, **kwargs):
        raise RuntimeError("disk on fire")

    monkeypatch.setattr(transaction_repository, "delete", failing_delete)
    with pytest.raises(RuntimeError):
        api.delete(f"{TX}/{parent['id']}")
    monkeypatch.undo()
    assert len(listing(api)) == 2
    assert balances(api)["Bank"] == "1898.00"


def test_simultaneous_creates_with_one_id_leave_one_parent_and_one_fee(api, settings, clock, db):
    app = api.app
    cookie = api.cookies.get("finance_session")
    csrf = api.headers["X-CSRF-Token"]
    accounts, cats = ids(api)
    key = str(uuid.uuid4())
    body = {
        "id": key,
        "name": "Sent to Ama",
        "amount": "100.00",
        "transaction_date": "2026-10-05",
        "account_id": accounts["Bank"],
        "category_id": cats["Family"],
        "fee_amount": "2.00",
    }
    statuses: list[int] = []
    errors: list[BaseException] = []

    def worker():
        try:
            with TestClient(app, headers={"Origin": FRONTEND_ORIGIN, "X-CSRF-Token": csrf}) as c:
                c.cookies.set("finance_session", cookie)
                statuses.append(c.post(f"{TX}/expenses", json=body).status_code)
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(6)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert not errors, errors
    assert sorted(set(statuses)) <= [200, 201]
    assert statuses.count(201) == 1
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(Transaction)) == 2
    assert balances(api)["Bank"] == "1898.00"
