import pytest
from sqlalchemy import func, select

from app.models import MonthlyBudget, Transaction

ACCOUNTS = "/api/v1/accounts"
TX = "/api/v1/transactions"
BUDGETS = "/api/v1/budgets"


def ids(client):
    accounts = {a["name"]: a["id"] for a in client.get(ACCOUNTS).json()["items"]}
    cats = {c["name"]: c["id"] for c in client.get("/api/v1/categories").json()["items"]}
    return accounts, cats


def spend(client, amount, on="2026-10-05", account="Bank", category="Food", **extra):
    accounts, cats = ids(client)
    response = client.post(
        f"{TX}/expenses",
        json={
            "name": "Spend",
            "amount": amount,
            "transaction_date": on,
            "account_id": accounts[account],
            "category_id": cats[category],
            **extra,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def earn(client, amount, on="2026-10-05"):
    accounts, cats = ids(client)
    response = client.post(
        f"{TX}/income",
        json={
            "name": "Pay",
            "amount": amount,
            "transaction_date": on,
            "account_id": accounts["Bank"],
            "category_id": cats["Salary"],
        },
    )
    assert response.status_code == 201


def set_allowance(client, year, month, allowance):
    return client.put(f"{BUDGETS}/{year}/{month}", json={"allowance": allowance})


@pytest.fixture
def api(auth_client, worked_example):
    return auth_client


def test_allowance_spent_remaining_and_percentage(api):
    set_allowance(api, 2026, 10, "3000.00")
    spend(api, "700.00")
    spend(api, "500.00")
    response = api.get(f"{BUDGETS}/2026/10")
    assert response.status_code == 200
    assert response.json() == {
        "month": "2026-10",
        "allowance": "3000.00",
        "total_expenses": "1200.00",
        "remaining": "1800.00",
        "percentage_used": "40.00",
        "is_over_budget": False,
    }


def test_overspending_gives_a_negative_remainder_and_no_error(api):
    set_allowance(api, 2026, 10, "3000.00")
    spend(api, "1200.00")
    spend(api, "2000.00")
    body = api.get(f"{BUDGETS}/2026/10").json()
    assert body["remaining"] == "-200.00"
    assert body["percentage_used"] == "106.67"
    assert body["is_over_budget"] is True


def test_fees_count_once_and_transfers_never(api):
    accounts, _ = ids(api)
    api.post(
        "/api/v1/transfers",
        json={
            "name": "Top up",
            "amount": "500.00",
            "transaction_date": "2026-10-05",
            "source_account_id": accounts["Bank"],
            "destination_account_id": accounts["MoMo"],
            "fee_amount": "5.00",
            "fee_account_id": accounts["MoMo"],
        },
    )
    spend(api, "100.00", account="Bank", category="Family", fee_amount="2.00")
    earn(api, "900.00")  # income is not spending
    body = api.get(f"{BUDGETS}/2026/10").json()
    assert body["total_expenses"] == "107.00"  # 5 (transfer fee) + 100 + 2 (payment fee)


def test_no_allowance_still_reports_spending(api):
    spend(api, "250.00")
    body = api.get(f"{BUDGETS}/2026/10").json()
    assert body == {
        "month": "2026-10",
        "allowance": None,
        "total_expenses": "250.00",
        "remaining": None,
        "percentage_used": None,
        "is_over_budget": False,
    }


def test_a_zero_allowance_has_no_percentage(api):
    set_allowance(api, 2026, 10, "0.00")
    spend(api, "100.00")
    body = api.get(f"{BUDGETS}/2026/10").json()
    assert body["allowance"] == "0.00"
    assert body["percentage_used"] is None
    assert body["remaining"] == "-100.00"
    assert body["is_over_budget"] is True


def test_an_empty_month_is_all_zeros(api):
    set_allowance(api, 2026, 10, "500.00")
    body = api.get(f"{BUDGETS}/2026/10").json()
    assert (body["total_expenses"], body["remaining"], body["percentage_used"]) == (
        "0.00",
        "500.00",
        "0.00",
    )


@pytest.mark.parametrize("allowance", ["-1.00", "1.234", "abc", "", None])
def test_invalid_allowances_are_refused(api, allowance):
    response = api.put(f"{BUDGETS}/2026/10", json={"allowance": allowance})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    assert api.get(f"{BUDGETS}/2026/10").json()["allowance"] is None


def test_a_missing_allowance_field_is_refused(api):
    assert api.put(f"{BUDGETS}/2026/10", json={}).status_code == 422


@pytest.mark.parametrize("path", ["1999/10", "2101/10", "2026/0", "2026/13", "2026/abc"])
def test_invalid_months_are_422(api, path):
    assert api.get(f"{BUDGETS}/{path}").status_code == 422
    assert api.put(f"{BUDGETS}/{path}", json={"allowance": "1.00"}).status_code == 422


def test_setting_twice_updates_one_row_and_leaves_transactions_alone(api, db):
    spend(api, "100.00")
    before = {a["name"]: a["balance"] for a in api.get(ACCOUNTS).json()["items"]}
    first = set_allowance(api, 2026, 10, "1000.00")
    second = set_allowance(api, 2026, 10, "2000.00")
    assert first.status_code == second.status_code == 200
    assert second.json()["allowance"] == "2000.00"
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(MonthlyBudget)) == 1
    assert db.scalar(select(func.count()).select_from(Transaction)) == 1
    assert {a["name"]: a["balance"] for a in api.get(ACCOUNTS).json()["items"]} == before


def test_the_allowance_is_per_month(api):
    set_allowance(api, 2026, 10, "3000.00")
    set_allowance(api, 2026, 11, "1000.00")
    assert api.get(f"{BUDGETS}/2026/10").json()["allowance"] == "3000.00"
    assert api.get(f"{BUDGETS}/2026/11").json()["allowance"] == "1000.00"


def test_month_boundaries_follow_the_transaction_date(api):
    spend(api, "10.00", on="2026-10-31")
    spend(api, "20.00", on="2026-11-01")
    assert api.get(f"{BUDGETS}/2026/10").json()["total_expenses"] == "10.00"
    assert api.get(f"{BUDGETS}/2026/11").json()["total_expenses"] == "20.00"


def test_moving_an_expense_to_another_month_updates_both_months(api):
    created = spend(api, "300.00", on="2026-10-20")
    assert api.get(f"{BUDGETS}/2026/10").json()["total_expenses"] == "300.00"
    api.patch(f"{TX}/{created['id']}", json={"version": 1, "transaction_date": "2026-11-02"})
    assert api.get(f"{BUDGETS}/2026/10").json()["total_expenses"] == "0.00"
    assert api.get(f"{BUDGETS}/2026/11").json()["total_expenses"] == "300.00"


def test_deleting_an_expense_updates_the_month(api):
    created = spend(api, "300.00")
    api.delete(f"{TX}/{created['id']}")
    assert api.get(f"{BUDGETS}/2026/10").json()["total_expenses"] == "0.00"


def test_the_list_defaults_to_the_last_twelve_months_newest_first(api):
    set_allowance(api, 2026, 10, "3000.00")
    spend(api, "100.00")
    items = api.get(BUDGETS).json()["items"]
    assert [item["month"] for item in items][:2] == ["2026-10", "2026-09"]
    assert len(items) == 12
    assert items[-1]["month"] == "2025-11"
    assert items[0]["allowance"] == "3000.00" and items[0]["total_expenses"] == "100.00"
    assert items[1]["allowance"] is None and items[1]["total_expenses"] == "0.00"


def test_the_list_honours_from_and_to(api):
    set_allowance(api, 2026, 9, "500.00")
    spend(api, "40.00", on="2026-10-02")
    items = api.get(BUDGETS, params={"from": "2026-08", "to": "2026-10"}).json()["items"]
    assert [item["month"] for item in items] == ["2026-10", "2026-09", "2026-08"]
    assert items[1]["allowance"] == "500.00"


@pytest.mark.parametrize(
    "params",
    [
        {"from": "2026-13"},
        {"to": "nope"},
        {"from": "2026-10", "to": "2026-08"},
        {"from": "2020-01", "to": "2026-10"},  # more than 36 months
    ],
)
def test_bad_list_ranges_are_422(api, params):
    assert api.get(BUDGETS, params=params).status_code == 422


def test_requires_a_session(auth_client):
    auth_client.cookies.clear()
    assert auth_client.get(f"{BUDGETS}/2026/10").status_code == 401
    assert auth_client.put(f"{BUDGETS}/2026/10", json={"allowance": "1.00"}).status_code == 401
    assert auth_client.get(BUDGETS).status_code == 401
