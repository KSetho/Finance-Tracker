from decimal import Decimal

import pytest

ACCOUNTS = "/api/v1/accounts"
TX = "/api/v1/transactions"
DASH = "/api/v1/dashboard"


def ids(client):
    accounts = {a["name"]: a["id"] for a in client.get(ACCOUNTS).json()["items"]}
    cats = {
        (c["category_type"], c["name"]): c["id"]
        for c in client.get("/api/v1/categories").json()["items"]
    }
    return accounts, cats


def expense(client, name, amount, on, account, category, **extra):
    accounts, cats = ids(client)
    response = client.post(
        f"{TX}/expenses",
        json={
            "name": name,
            "amount": amount,
            "transaction_date": on,
            "account_id": accounts[account],
            "category_id": cats[("expense", category)],
            **extra,
        },
    )
    assert response.status_code == 201, response.text


def income(client, name, amount, on, account, category):
    accounts, cats = ids(client)
    response = client.post(
        f"{TX}/income",
        json={
            "name": name,
            "amount": amount,
            "transaction_date": on,
            "account_id": accounts[account],
            "category_id": cats[("income", category)],
        },
    )
    assert response.status_code == 201, response.text


def transfer(client, source, destination, amount, on, **extra):
    accounts, _ = ids(client)
    body = {
        "name": f"{source} to {destination}",
        "amount": amount,
        "transaction_date": on,
        "source_account_id": accounts[source],
        "destination_account_id": accounts[destination],
    }
    if "fee_amount" in extra:
        body["fee_amount"] = extra["fee_amount"]
        body["fee_account_id"] = accounts[extra["fee_account"]]
    assert client.post("/api/v1/transfers", json=body).status_code == 201


@pytest.fixture
def api(auth_client, worked_example):
    c = auth_client
    income(c, "Salary", "3000.00", "2026-10-01", "Bank", "Salary")
    transfer(c, "Bank", "MoMo", "500.00", "2026-10-05")
    transfer(c, "MoMo", "Cash", "500.00", "2026-10-05", fee_amount="5.00", fee_account="MoMo")
    expense(c, "Groceries", "150.00", "2026-10-06", "Bank", "Food")
    expense(c, "Taxi", "40.00", "2026-10-07", "MoMo", "Transport")
    income(c, "Gift", "100.00", "2026-11-02", "MoMo", "Gift")
    expense(c, "Airtime", "10.00", "2026-11-03", "MoMo", "Bills")
    return c


def summary(client, month="2026-10"):
    response = client.get(f"{DASH}/summary", params={"month": month})
    assert response.status_code == 200, response.text
    return response.json()


def test_summary_for_the_worked_month(api):
    body = summary(api)
    assert body["month"] == "2026-10"
    assert body["currency"] == "GHS"
    assert body["total_income"] == "3000.00"
    assert body["total_expenses"] == "195.00"  # 150 + 40 + the 5 fee, counted once
    assert body["fee_total"] == "5.00"  # a subset of the expenses
    assert body["net_cash_flow"] == "2805.00"
    assert body["combined_balance"] == "5195.00"  # now, not as of the month: includes November
    assert {a["name"]: a["balance"] for a in body["accounts"]} == {
        "Bank": "4350.00",
        "MoMo": "345.00",
        "Cash": "500.00",
    }


def test_transfers_are_in_neither_income_nor_expenses(api):
    body = summary(api)
    assert Decimal(body["total_income"]) == Decimal("3000.00")  # not 3000 + 1000 of transfers
    assert Decimal(body["total_expenses"]) < Decimal("500.00")


def test_the_summary_embeds_the_budget(api):
    api.put("/api/v1/budgets/2026/10", json={"allowance": "1000.00"})
    budget = summary(api)["budget"]
    assert budget == {
        "month": "2026-10",
        "allowance": "1000.00",
        "total_expenses": "195.00",
        "remaining": "805.00",
        "percentage_used": "19.50",
        "is_over_budget": False,
    }


def test_figures_reconcile_with_the_transaction_history(api):
    rows = api.get(
        TX, params={"page_size": 100, "start_date": "2026-10-01", "end_date": "2026-10-31"}
    ).json()["items"]
    income_sum = sum(Decimal(r["amount"]) for r in rows if r["type"] == "income")
    expense_sum = sum(Decimal(r["amount"]) for r in rows if r["type"] == "expense")
    fee_sum = sum(Decimal(r["amount"]) for r in rows if r["is_fee"])
    body = summary(api)
    assert Decimal(body["total_income"]) == income_sum
    assert Decimal(body["total_expenses"]) == expense_sum
    assert Decimal(body["fee_total"]) == fee_sum
    assert Decimal(body["net_cash_flow"]) == income_sum - expense_sum


def test_the_default_month_is_the_current_month_in_ghana(api):
    body = api.get(f"{DASH}/summary").json()
    assert body["month"] == "2026-10"  # the fake clock says 17 Oct 2026
    assert body["total_income"] == "3000.00"


def test_an_empty_month_is_all_zeros(api):
    body = summary(api, "2026-01")
    assert (
        body["total_income"],
        body["total_expenses"],
        body["fee_total"],
        body["net_cash_flow"],
    ) == (
        "0.00",
        "0.00",
        "0.00",
        "0.00",
    )
    assert body["budget"]["allowance"] is None
    assert len(body["accounts"]) == 3


def test_archived_accounts_leave_the_summary(api):
    accounts, _ = ids(api)
    api.post(f"{ACCOUNTS}/{accounts['Cash']}/archive")
    body = summary(api)
    assert {a["name"] for a in body["accounts"]} == {"Bank", "MoMo"}
    assert body["combined_balance"] == "4695.00"


@pytest.mark.parametrize("month", ["2026-13", "2026-1", "nope", "2026-10-01"])
def test_a_bad_month_is_422(api, month):
    assert api.get(f"{DASH}/summary", params={"month": month}).status_code == 422


def test_spending_by_category_with_fees_as_their_own_category(api):
    body = api.get(f"{DASH}/spending-by-category", params={"month": "2026-10"}).json()
    assert body["total_expenses"] == "195.00"
    assert [(i["name"], i["amount"]) for i in body["items"]] == [
        ("Food", "150.00"),
        ("Transport", "40.00"),
        ("Fees", "5.00"),
    ]
    assert all(i["category_id"] for i in body["items"])


def test_shares_add_up_to_exactly_one_hundred(api):
    items = api.get(f"{DASH}/spending-by-category", params={"month": "2026-10"}).json()["items"]
    assert [i["share_percent"] for i in items] == ["76.92", "20.51", "2.57"]
    assert sum(Decimal(i["share_percent"]) for i in items) == Decimal("100.00")


def test_spending_total_equals_the_sum_of_its_items(api):
    body = api.get(f"{DASH}/spending-by-category", params={"month": "2026-10"}).json()
    assert sum(Decimal(i["amount"]) for i in body["items"]) == Decimal(body["total_expenses"])


def test_spending_can_use_a_date_range(api):
    body = api.get(
        f"{DASH}/spending-by-category",
        params={"start_date": "2026-10-07", "end_date": "2026-10-31"},
    ).json()
    assert [(i["name"], i["share_percent"]) for i in body["items"]] == [("Transport", "100.00")]


def test_no_spending_gives_an_empty_list(api):
    body = api.get(f"{DASH}/spending-by-category", params={"month": "2026-01"}).json()
    assert body == {"total_expenses": "0.00", "items": []}


@pytest.mark.parametrize(
    "params",
    [
        {"start_date": "2026-10-01"},  # needs both ends
        {"start_date": "2026-10-10", "end_date": "2026-10-01"},
        {"month": "2026-10", "start_date": "2026-10-01", "end_date": "2026-10-31"},
        {"month": "bad"},
    ],
)
def test_spending_bad_periods_are_422(api, params):
    assert api.get(f"{DASH}/spending-by-category", params=params).status_code == 422


def test_cash_flow_groups_by_day_for_up_to_31_days_and_fills_gaps(api):
    body = api.get(
        f"{DASH}/cash-flow", params={"start_date": "2026-10-01", "end_date": "2026-10-31"}
    ).json()
    assert body["group_by"] == "day"
    assert len(body["buckets"]) == 31
    by_period = {b["period"]: b for b in body["buckets"]}
    assert by_period["2026-10-01"]["income"] == "3000.00"
    assert (
        by_period["2026-10-05"]["expenses"] == "5.00"
    )  # only the fee: the transfers are not spending
    assert by_period["2026-10-02"] == {"period": "2026-10-02", "income": "0.00", "expenses": "0.00"}
    assert (body["income"], body["expenses"], body["net"]) == ("3000.00", "195.00", "2805.00")
    assert sum(Decimal(b["income"]) for b in body["buckets"]) == Decimal(body["income"])
    assert sum(Decimal(b["expenses"]) for b in body["buckets"]) == Decimal(body["expenses"])


def test_cash_flow_groups_by_month_beyond_31_days(api):
    body = api.get(
        f"{DASH}/cash-flow", params={"start_date": "2026-10-01", "end_date": "2026-11-30"}
    ).json()
    assert body["group_by"] == "month"
    assert body["buckets"] == [
        {"period": "2026-10", "income": "3000.00", "expenses": "195.00"},
        {"period": "2026-11", "income": "100.00", "expenses": "10.00"},
    ]
    assert body["net"] == "2895.00"


def test_thirty_two_days_is_already_monthly(api):
    body = api.get(
        f"{DASH}/cash-flow", params={"start_date": "2026-10-01", "end_date": "2026-11-01"}
    ).json()
    assert body["group_by"] == "month"


def test_cash_flow_can_be_filtered_by_category(api):
    _, cats = ids(api)
    body = api.get(
        f"{DASH}/cash-flow",
        params={
            "start_date": "2026-10-01",
            "end_date": "2026-10-31",
            "category_id": cats[("expense", "Food")],
        },
    ).json()
    assert (body["income"], body["expenses"], body["net"]) == ("0.00", "150.00", "-150.00")


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"start_date": "2026-10-01"},
        {"start_date": "2026-10-10", "end_date": "2026-10-01"},
        {"start_date": "2020-01-01", "end_date": "2026-10-31"},  # more than 3 years
        {"start_date": "bad", "end_date": "2026-10-31"},
    ],
)
def test_cash_flow_bad_ranges_are_422(api, params):
    assert api.get(f"{DASH}/cash-flow", params=params).status_code == 422


def test_calendar_returns_every_day_with_exact_daily_totals(api):
    response = api.get(f"{DASH}/calendar", params={"month": "2026-10"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["month"] == "2026-10"
    assert len(body["days"]) == 31
    assert [day["date"] for day in body["days"]] == [f"2026-10-{day:02d}" for day in range(1, 32)]

    by_date = {day["date"]: day for day in body["days"]}
    assert by_date["2026-10-01"] == {
        "date": "2026-10-01",
        "income": "3000.00",
        "expenses": "0.00",
        "net": "3000.00",
        "transaction_count": 1,
    }
    assert by_date["2026-10-05"] == {
        "date": "2026-10-05",
        "income": "0.00",
        "expenses": "5.00",
        "net": "-5.00",
        "transaction_count": 3,
    }
    assert by_date["2026-10-02"] == {
        "date": "2026-10-02",
        "income": "0.00",
        "expenses": "0.00",
        "net": "0.00",
        "transaction_count": 0,
    }


def test_calendar_keeps_transfer_only_days_visible(auth_client, worked_example):
    transfer(auth_client, "Bank", "MoMo", "25.00", "2026-02-14")
    body = auth_client.get(f"{DASH}/calendar", params={"month": "2026-02"}).json()
    assert len(body["days"]) == 28
    transfer_day = body["days"][13]
    assert transfer_day == {
        "date": "2026-02-14",
        "income": "0.00",
        "expenses": "0.00",
        "net": "0.00",
        "transaction_count": 1,
    }


@pytest.mark.parametrize("month", [None, "2026-13", "2026-1", "nope", "2026-10-01"])
def test_calendar_requires_a_valid_month(api, month):
    params = {} if month is None else {"month": month}
    assert api.get(f"{DASH}/calendar", params=params).status_code == 422


def test_recent_transactions_are_newest_first_and_include_transfers_and_fees(api):
    items = api.get(f"{DASH}/recent-transactions").json()["items"]
    assert len(items) == 8  # everything there is; the default limit is 10
    assert items[0]["name"] == "Airtime"
    assert {"transfer", "income", "expense"} <= {i["type"] for i in items}
    assert any(i["is_fee"] for i in items)
    dates = [i["transaction_date"] for i in items]
    assert dates == sorted(dates, reverse=True)


def test_recent_transactions_limit(api):
    assert len(api.get(f"{DASH}/recent-transactions", params={"limit": 3}).json()["items"]) == 3
    assert api.get(f"{DASH}/recent-transactions", params={"limit": 0}).status_code == 422
    assert api.get(f"{DASH}/recent-transactions", params={"limit": 51}).status_code == 422


def test_requires_a_session(auth_client):
    auth_client.cookies.clear()
    for path, params in (
        ("summary", {}),
        ("spending-by-category", {}),
        ("calendar", {"month": "2026-10"}),
        ("recent-transactions", {}),
    ):
        assert auth_client.get(f"{DASH}/{path}", params=params).status_code == 401
    assert (
        auth_client.get(
            f"{DASH}/cash-flow", params={"start_date": "2026-10-01", "end_date": "2026-10-02"}
        ).status_code
        == 401
    )
