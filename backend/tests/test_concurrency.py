import threading
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.models import Transaction
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


@pytest.fixture
def api(auth_client, worked_example):
    return auth_client


def run_parallel(api, jobs):
    """Run each (method, url, json) in its own thread with its own client; return the statuses."""
    cookie = api.cookies.get("finance_session")
    headers = {"Origin": FRONTEND_ORIGIN, "X-CSRF-Token": api.headers["X-CSRF-Token"]}
    results: list = [None] * len(jobs)
    barrier = threading.Barrier(len(jobs))

    def worker(index, method, url, body):
        try:
            with TestClient(api.app, headers=headers) as client:
                client.cookies.set("finance_session", cookie)
                barrier.wait(timeout=10)
                results[index] = client.request(method, url, json=body).status_code
        except BaseException as exc:  # noqa: BLE001
            results[index] = exc

    threads = [threading.Thread(target=worker, args=(i, *job)) for i, job in enumerate(jobs)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not any(isinstance(r, BaseException) for r in results), results
    return results


def test_simultaneous_duplicate_expenses_create_one_entry(api, db):
    accounts, cats = ids(api)
    body = {
        "id": str(uuid.uuid4()),
        "name": "Once",
        "amount": "100.00",
        "transaction_date": "2026-10-05",
        "account_id": accounts["Bank"],
        "category_id": cats["Food"],
    }
    statuses = run_parallel(api, [("POST", f"{TX}/expenses", body)] * 10)
    assert sorted(set(statuses)) <= [200, 201]
    assert statuses.count(201) == 1
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(Transaction)) == 1
    assert balances(api)["Bank"] == "1900.00"


def test_simultaneous_duplicate_transfers_create_one_transfer_and_one_fee(api, db):
    accounts, _ = ids(api)
    body = {
        "id": str(uuid.uuid4()),
        "name": "Top up",
        "amount": "100.00",
        "transaction_date": "2026-10-05",
        "source_account_id": accounts["Bank"],
        "destination_account_id": accounts["MoMo"],
        "fee_amount": "2.00",
        "fee_account_id": accounts["MoMo"],
    }
    statuses = run_parallel(api, [("POST", TRANSFERS, body)] * 8)
    assert sorted(set(statuses)) <= [200, 201] and statuses.count(201) == 1
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(Transaction)) == 2
    assert balances(api) == {"Bank": "1900.00", "MoMo": "398.00", "Cash": "0.00"}


def test_two_edits_with_the_same_version_one_wins_one_is_told_it_is_stale(api):
    accounts, cats = ids(api)
    created = api.post(
        f"{TX}/expenses",
        json={
            "name": "x",
            "amount": "10.00",
            "transaction_date": "2026-10-05",
            "account_id": accounts["Bank"],
            "category_id": cats["Food"],
        },
    ).json()
    jobs = [
        ("PATCH", f"{TX}/{created['id']}", {"version": 1, "amount": "20.00"}),
        ("PATCH", f"{TX}/{created['id']}", {"version": 1, "amount": "30.00"}),
    ]
    statuses = run_parallel(api, jobs)
    assert sorted(statuses) == [200, 409]
    final = api.get(f"{TX}/{created['id']}").json()
    assert final["version"] == 2 and final["amount"] in {"20.00", "30.00"}


def test_many_transfers_between_the_same_accounts_keep_the_total(api):
    accounts, _ = ids(api)
    jobs = []
    for i in range(12):
        source, destination = ("Bank", "MoMo") if i % 2 == 0 else ("MoMo", "Bank")
        jobs.append(
            (
                "POST",
                TRANSFERS,
                {
                    "name": f"t{i}",
                    "amount": "10.00",
                    "transaction_date": "2026-10-05",
                    "source_account_id": accounts[source],
                    "destination_account_id": accounts[destination],
                    "fee_amount": "1.00",
                    "fee_account_id": accounts[source],
                },
            )
        )
    assert set(run_parallel(api, jobs)) == {201}
    after = api.get(ACCOUNTS).json()
    assert after["combined_balance"] == "2288.00"  # 2300 less twelve 1.00 fees; transfers net to 0


def test_payments_whose_fees_hit_the_other_account_do_not_deadlock(api):
    """Opposite lock orders (account A then B, and B then A) must not end in a deadlock."""
    accounts, cats = ids(api)
    jobs = []
    for i in range(12):
        paying, fee = ("Bank", "MoMo") if i % 2 == 0 else ("MoMo", "Bank")
        jobs.append(
            (
                "POST",
                f"{TX}/expenses",
                {
                    "name": f"p{i}",
                    "amount": "5.00",
                    "transaction_date": "2026-10-05",
                    "account_id": accounts[paying],
                    "category_id": cats["Family"],
                    "fee_amount": "1.00",
                    "fee_account_id": accounts[fee],
                },
            )
        )
    statuses = run_parallel(api, jobs)
    assert set(statuses) == {201}, statuses
    assert api.get(ACCOUNTS).json()["combined_balance"] == "2228.00"  # 2300 - 12 * 6.00


def test_an_edit_racing_a_delete_never_leaves_an_orphan_fee(api, db):
    accounts, _ = ids(api)
    parent = api.post(
        TRANSFERS,
        json={
            "name": "t",
            "amount": "50.00",
            "transaction_date": "2026-10-05",
            "source_account_id": accounts["Bank"],
            "destination_account_id": accounts["MoMo"],
            "fee_amount": "2.00",
            "fee_account_id": accounts["Bank"],
        },
    ).json()
    jobs = [
        ("PATCH", f"{TRANSFERS}/{parent['id']}", {"version": 1, "fee_amount": "3.00"}),
        ("DELETE", f"{TRANSFERS}/{parent['id']}", None),
    ]
    statuses = run_parallel(api, jobs)
    assert set(statuses) <= {200, 204, 404, 409}
    db.expire_all()
    rows = db.scalars(select(Transaction)).all()
    ids_present = {r.id for r in rows}
    for row in rows:
        if row.related_transaction_id:
            assert row.related_transaction_id in ids_present
