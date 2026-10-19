"""A long, seeded sequence of random operations. After every step the books must balance, and at
the end every report must agree with the transaction history to the pesewa."""

import random
from decimal import Decimal

import pytest

ACCOUNTS = "/api/v1/accounts"
TX = "/api/v1/transactions"
TRANSFERS = "/api/v1/transfers"
START, END_MONTHS = "2026-10-01", ("2026-10", "2026-11", "2026-12")
OPENING_TOTAL = Decimal("2300.00")  # Bank 2000 + MoMo 300 + Cash 0


def money(rng: random.Random, low: int = 1, high: int = 60000) -> str:
    return str((Decimal(rng.randint(low, high)) / 100).quantize(Decimal("0.01")))


def day(rng: random.Random) -> str:
    month = rng.choice([10, 11, 12])
    return f"2026-{month:02d}-{rng.randint(1, 28):02d}"


def all_rows(client):
    rows, page = [], 1
    while True:
        body = client.get(TX, params={"page_size": 100, "page": page}).json()
        rows += body["items"]
        if len(rows) >= body["total"]:
            return rows
        page += 1


def check_books(client):
    rows = all_rows(client)
    by_id = {r["id"]: r for r in rows}
    income = sum((Decimal(r["amount"]) for r in rows if r["type"] == "income"), Decimal(0))
    expenses = sum((Decimal(r["amount"]) for r in rows if r["type"] == "expense"), Decimal(0))
    listing = client.get(ACCOUNTS).json()
    balances = sum((Decimal(a["balance"]) for a in listing["items"]), Decimal(0))
    # transfers move money between accounts and change the total by nothing
    assert balances == OPENING_TOTAL + income - expenses
    assert Decimal(listing["combined_balance"]) == balances

    fee_rows = [r for r in rows if r["is_fee"]]
    parents = [r["related_transaction_id"] for r in fee_rows]
    assert len(parents) == len(set(parents)), "two fees for one parent"
    for fee in fee_rows:
        parent = by_id[fee["related_transaction_id"]]  # no dangling fee
        assert Decimal(parent["fee_amount"]) == Decimal(fee["amount"])
        assert fee["transaction_date"] == parent["transaction_date"]
        assert fee["category"]["name"] == "Fees"
    for row in rows:
        if not row["is_fee"] and row["id"] not in parents:
            assert Decimal(row["fee_amount"]) == 0
    return rows


@pytest.fixture
def setup(auth_client, worked_example):
    c = auth_client
    accounts = {a["name"]: a["id"] for a in c.get(ACCOUNTS).json()["items"]}
    cats = {
        (x["category_type"], x["name"]): x["id"]
        for x in c.get("/api/v1/categories").json()["items"]
    }
    return c, accounts, cats


def test_two_hundred_random_operations_always_reconcile(setup):
    client, accounts, cats = setup
    rng = random.Random(20261017)
    names = list(accounts)
    expense_cats = [cid for (kind, _), cid in cats.items() if kind == "expense" and _ != "Fees"]
    income_cats = [cid for (kind, _), cid in cats.items() if kind == "income"]
    live: dict[str, dict] = {}

    def remember(response, expected=201):
        assert response.status_code == expected, response.text
        body = response.json()
        live[body["id"]] = body
        return body

    for step in range(200):
        action = rng.choices(
            ["income", "expense", "payment", "transfer", "edit", "delete"],
            weights=[15, 20, 15, 20, 20, 10],
        )[0]
        if action in {"edit", "delete"} and not live:
            action = "income"

        if action == "income":
            remember(
                client.post(
                    f"{TX}/income",
                    json={
                        "name": "Pay",
                        "amount": money(rng),
                        "transaction_date": day(rng),
                        "account_id": accounts[rng.choice(names)],
                        "category_id": rng.choice(income_cats),
                    },
                )
            )
        elif action in {"expense", "payment"}:
            body = {
                "name": "Spend",
                "amount": money(rng, high=20000),
                "transaction_date": day(rng),
                "account_id": accounts[rng.choice(names)],
                "category_id": rng.choice(expense_cats),
            }
            if action == "payment":
                body["fee_amount"] = money(rng, high=500)
                body["fee_account_id"] = accounts[rng.choice(names)]
            remember(client.post(f"{TX}/expenses", json=body))
        elif action == "transfer":
            source, destination = rng.sample(names, 2)
            body = {
                "name": f"{source} to {destination}",
                "amount": money(rng, high=30000),
                "transaction_date": day(rng),
                "source_account_id": accounts[source],
                "destination_account_id": accounts[destination],
            }
            if rng.random() < 0.5:
                body["fee_amount"] = money(rng, high=500)
                body["fee_account_id"] = accounts[rng.choice([source, destination])]
            remember(client.post(TRANSFERS, json=body))
        elif action == "edit":
            parent = live[rng.choice(list(live))]
            patch = {"version": parent["version"]}
            if rng.random() < 0.6:
                patch["amount"] = money(rng, high=20000)
            if rng.random() < 0.5:
                patch["transaction_date"] = day(rng)
            if rng.random() < 0.3:
                patch["name"] = f"Edited {step}"
            if parent["type"] != "income" and rng.random() < 0.5:
                patch["fee_amount"] = rng.choice(["0.00", money(rng, high=500)])
                if parent["type"] == "transfer":
                    patch["fee_account_id"] = rng.choice(
                        [parent["account"]["id"], parent["destination_account"]["id"]]
                    )
            path = TRANSFERS if parent["type"] == "transfer" else TX
            remember(client.patch(f"{path}/{parent['id']}", json=patch), expected=200)
        else:  # delete
            victim = live.pop(rng.choice(list(live)))
            assert client.delete(f"{TX}/{victim['id']}").status_code == 204

        if step % 10 == 9:
            check_books(client)

    rows = check_books(client)

    # every report agrees with the history, month by month
    for month in END_MONTHS:
        in_month = [r for r in rows if r["transaction_date"].startswith(month)]
        income = sum((Decimal(r["amount"]) for r in in_month if r["type"] == "income"), Decimal(0))
        expenses = sum(
            (Decimal(r["amount"]) for r in in_month if r["type"] == "expense"), Decimal(0)
        )
        fees = sum((Decimal(r["amount"]) for r in in_month if r["is_fee"]), Decimal(0))

        summary = client.get("/api/v1/dashboard/summary", params={"month": month}).json()
        assert Decimal(summary["total_income"]) == income
        assert Decimal(summary["total_expenses"]) == expenses
        assert Decimal(summary["fee_total"]) == fees
        assert Decimal(summary["net_cash_flow"]) == income - expenses

        year, mon = month.split("-")
        budget = client.get(f"/api/v1/budgets/{year}/{int(mon)}").json()
        assert Decimal(budget["total_expenses"]) == expenses

        spending = client.get(
            "/api/v1/dashboard/spending-by-category", params={"month": month}
        ).json()
        assert sum((Decimal(i["amount"]) for i in spending["items"]), Decimal(0)) == expenses
        if spending["items"]:
            assert sum(
                (Decimal(i["share_percent"]) for i in spending["items"]), Decimal(0)
            ) == Decimal("100.00")

        last = {"10": 31, "11": 30, "12": 31}[mon]
        flow = client.get(
            "/api/v1/dashboard/cash-flow",
            params={"start_date": f"{month}-01", "end_date": f"{month}-{last}"},
        ).json()
        assert (Decimal(flow["income"]), Decimal(flow["expenses"])) == (income, expenses)
        assert sum((Decimal(b["expenses"]) for b in flow["buckets"]), Decimal(0)) == expenses
