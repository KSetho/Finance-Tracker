import logging

import pytest

ACCOUNTS = "/api/v1/accounts"
TX = "/api/v1/transactions"
TRANSFERS = "/api/v1/transfers"

# Values that must never appear in logs: free text and money the owner typed, plus credentials.
SECRET_TEXT = [
    "Salary from Kwame Mensah",
    "private description",
    "Secret Savings Account",
    "123.45",
]


@pytest.fixture
def api(auth_client, worked_example):
    return auth_client


def test_money_operations_log_event_names_and_ids_only(api, caplog):
    caplog.set_level(logging.DEBUG)
    ids = {a["name"]: a["id"] for a in api.get(ACCOUNTS).json()["items"]}
    cats = {c["name"]: c["id"] for c in api.get("/api/v1/categories").json()["items"]}

    created_account = api.post(
        ACCOUNTS,
        json={
            "name": "Secret Savings Account",
            "account_type": "bank",
            "opening_balance": "999.99",
            "opening_date": "2026-10-01",
        },
    ).json()
    api.post(f"{ACCOUNTS}/{created_account['id']}/archive")
    expense = api.post(
        f"{TX}/expenses",
        json={
            "name": "Salary from Kwame Mensah",
            "description": "private description",
            "amount": "123.45",
            "transaction_date": "2026-10-05",
            "account_id": ids["Bank"],
            "category_id": cats["Food"],
            "fee_amount": "2.00",
        },
    ).json()
    api.patch(f"{TX}/{expense['id']}", json={"version": 1, "amount": "10.00"})
    transfer = api.post(
        TRANSFERS,
        json={
            "name": "Secret move",
            "amount": "50.00",
            "transaction_date": "2026-10-05",
            "source_account_id": ids["Bank"],
            "destination_account_id": ids["MoMo"],
        },
    ).json()
    api.patch(f"{TRANSFERS}/{transfer['id']}", json={"version": 1, "amount": "60.00"})
    api.delete(f"{TRANSFERS}/{transfer['id']}")
    api.delete(f"{TX}/{expense['id']}")
    api.put("/api/v1/budgets/2026/10", json={"allowance": "777.77"})

    logged = "\n".join(record.getMessage() for record in caplog.records)
    for event in (
        "account_created",
        "account_archived",
        "transaction_created",
        "transaction_updated",
        "transaction_deleted",
        "transfer_created",
        "transfer_updated",
        "transfer_deleted",
        "budget_set",
    ):
        assert event in logged, event
    assert expense["id"] in logged and transfer["id"] in logged and created_account["id"] in logged

    secrets = SECRET_TEXT + ["Secret move", "999.99", "777.77", "60.00", "50.00", "10.00"]
    token = api.cookies.get("finance_session")
    for secret in [*secrets, token, api.headers["X-CSRF-Token"]]:
        assert secret not in logged, f"{secret!r} leaked into the logs"
