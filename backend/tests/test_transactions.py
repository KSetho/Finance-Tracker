import uuid

import pytest

ACCOUNTS = "/api/v1/accounts"
TX = "/api/v1/transactions"


def categories(api):
    items = api.get("/api/v1/categories").json()["items"]
    return {(c["category_type"], c["name"]): c["id"] for c in items}


def balances(api):
    return {a["name"]: a["balance"] for a in api.get(ACCOUNTS).json()["items"]}


def account_id(api, name):
    return next(a["id"] for a in api.get(ACCOUNTS).json()["items"] if a["name"] == name)


def add_income(api, account="Bank", amount="500.00", category="Salary", **extra):
    body = {
        "name": "Salary",
        "amount": amount,
        "transaction_date": "2026-10-05",
        "account_id": account_id(api, account),
        "category_id": categories(api).get(("income", category)) if category else None,
        **extra,
    }
    return api.post(f"{TX}/income", json=body)


def add_expense(api, account="Bank", amount="100.00", category="Food", **extra):
    body = {
        "name": "Groceries",
        "amount": amount,
        "transaction_date": "2026-10-05",
        "account_id": account_id(api, account),
        "category_id": categories(api)[("expense", category)] if category else None,
        **extra,
    }
    return api.post(f"{TX}/expenses", json=body)


@pytest.fixture
def api(auth_client, worked_example):
    return auth_client


def test_default_categories_and_type_filter(api):
    everything = api.get("/api/v1/categories").json()["items"]
    assert len(everything) == 13
    assert all(c["is_system"] for c in everything)
    income = api.get("/api/v1/categories", params={"type": "income"}).json()["items"]
    expense = api.get("/api/v1/categories", params={"type": "expense"}).json()["items"]
    assert {c["name"] for c in income} == {
        "Salary",
        "Freelance",
        "Business",
        "Gift",
        "Other income",
    }
    assert {c["name"] for c in expense} == {
        "Food",
        "Transport",
        "Bills",
        "Shopping",
        "Health",
        "Family",
        "Fees",
        "Other expense",
    }
    assert api.get("/api/v1/categories", params={"type": "other"}).status_code == 422


def test_income_raises_the_balance_and_returns_the_entry(api):
    response = add_income(api, "Bank", "500.00", description="October pay")
    assert response.status_code == 201
    body = response.json()
    assert body["type"] == "income"
    assert body["amount"] == "500.00"
    assert body["account"]["name"] == "Bank"
    assert body["destination_account"] is None
    assert body["category"]["name"] == "Salary"
    assert body["description"] == "October pay"
    assert (body["fee_amount"], body["fee"], body["is_fee"], body["version"]) == (
        "0.00",
        None,
        False,
        1,
    )
    assert balances(api)["Bank"] == "2500.00"


def test_expense_lowers_the_balance(api):
    response = add_expense(api, "Bank", "100.00")
    assert response.status_code == 201
    assert response.json()["type"] == "expense"
    assert balances(api)["Bank"] == "1900.00"


def test_an_expense_larger_than_the_balance_is_allowed(api):
    assert add_expense(api, "Cash", "5000.00").status_code == 201
    assert balances(api)["Cash"] == "-5000.00"
    assert api.get(ACCOUNTS).json()["combined_balance"] == "-2700.00"


def test_future_dates_are_allowed_and_the_name_is_trimmed(api):
    response = add_expense(api, name="  Rent  ", transaction_date="2027-01-01")
    assert response.status_code == 201
    assert response.json()["name"] == "Rent"
    assert response.json()["transaction_date"] == "2027-01-01"


def test_expense_requires_an_expense_category(api):
    cats = categories(api)
    wrong = add_expense(api, category=None)
    wrong_type = api.post(
        f"{TX}/expenses",
        json={
            "name": "x",
            "amount": "1.00",
            "transaction_date": "2026-10-05",
            "account_id": account_id(api, "Bank"),
            "category_id": cats[("income", "Salary")],
        },
    )
    assert wrong.status_code == 422
    assert wrong_type.status_code == 422
    assert wrong_type.json()["error"]["code"] == "category_type_mismatch"
    assert balances(api)["Bank"] == "2000.00"


def test_income_category_is_optional_but_must_be_an_income_category(api):
    assert add_income(api, category=None).status_code == 201
    mismatch = api.post(
        f"{TX}/income",
        json={
            "name": "x",
            "amount": "1.00",
            "transaction_date": "2026-10-05",
            "account_id": account_id(api, "Bank"),
            "category_id": categories(api)[("expense", "Food")],
        },
    )
    assert mismatch.status_code == 422
    assert mismatch.json()["error"]["code"] == "category_type_mismatch"


@pytest.mark.parametrize(
    "override",
    [
        {"amount": "0"},
        {"amount": "0.00"},
        {"amount": "-1.00"},
        {"amount": "1.234"},
        {"amount": "abc"},
        {"amount": ""},
        {"name": ""},
        {"name": "   "},
        {"name": "x" * 121},
        {"transaction_date": "not-a-date"},
        {"transaction_date": "2026-02-30"},
        {"description": "d" * 501},
    ],
)
def test_invalid_input_returns_422_and_changes_nothing(api, override):
    response = add_expense(api, **override)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    assert balances(api)["Bank"] == "2000.00"


def test_unknown_account_or_category_is_404(api):
    unknown_account = api.post(
        f"{TX}/expenses",
        json={
            "name": "x",
            "amount": "1.00",
            "transaction_date": "2026-10-05",
            "account_id": str(uuid.uuid4()),
            "category_id": categories(api)[("expense", "Food")],
        },
    )
    unknown_category = api.post(
        f"{TX}/expenses",
        json={
            "name": "x",
            "amount": "1.00",
            "transaction_date": "2026-10-05",
            "account_id": account_id(api, "Bank"),
            "category_id": str(uuid.uuid4()),
        },
    )
    assert unknown_account.status_code == 404
    assert unknown_category.status_code == 404


def test_archived_accounts_cannot_receive_new_entries(api):
    cash = account_id(api, "Cash")
    api.post(f"{ACCOUNTS}/{cash}/archive")
    response = (
        add_expense(api, "Cash")
        if False
        else api.post(
            f"{TX}/expenses",
            json={
                "name": "x",
                "amount": "1.00",
                "transaction_date": "2026-10-05",
                "account_id": cash,
                "category_id": categories(api)[("expense", "Food")],
            },
        )
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "account_archived"


def test_entries_before_the_accounts_opening_date_are_refused(api):
    response = add_expense(api, transaction_date="2026-09-30")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "before_opening_date"
    assert add_expense(api, transaction_date="2026-10-01").status_code == 201


def test_account_opening_date_cannot_move_past_existing_activity(api):
    add_expense(api, "Bank", transaction_date="2026-10-05")
    bank = account_id(api, "Bank")
    refused = api.patch(f"{ACCOUNTS}/{bank}", json={"opening_date": "2026-10-10"})
    assert refused.status_code == 422
    assert refused.json()["error"]["code"] == "activity_before_opening_date"
    assert api.patch(f"{ACCOUNTS}/{bank}", json={"opening_date": "2026-10-05"}).status_code == 200


def test_retry_with_the_same_id_creates_one_entry(api):
    key = str(uuid.uuid4())
    first = add_expense(api, id=key)
    second = add_expense(api, id=key)
    assert (first.status_code, second.status_code) == (201, 200)
    assert first.json()["id"] == second.json()["id"] == key
    assert balances(api)["Bank"] == "1900.00"  # charged once


def test_reusing_an_id_with_different_fields_is_a_conflict(api):
    key = str(uuid.uuid4())
    add_expense(api, id=key)
    response = add_expense(api, id=key, amount="999.00")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "id_conflict"
    assert balances(api)["Bank"] == "1900.00"


def test_get_one_entry(api):
    created = add_expense(api).json()
    fetched = api.get(f"{TX}/{created['id']}")
    assert fetched.status_code == 200
    assert fetched.json() == created
    assert api.get(f"{TX}/{uuid.uuid4()}").status_code == 404
    assert api.get(f"{TX}/nope").status_code == 422


def test_edit_changes_fields_and_rebalances_both_accounts(api):
    created = add_expense(api, "Bank", "100.00").json()
    cats = categories(api)
    response = api.patch(
        f"{TX}/{created['id']}",
        json={
            "version": 1,
            "name": "Taxi",
            "description": "to town",
            "amount": "150.00",
            "transaction_date": "2026-10-10",
            "account_id": account_id(api, "MoMo"),
            "category_id": cats[("expense", "Transport")],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert (body["name"], body["description"], body["amount"], body["transaction_date"]) == (
        "Taxi",
        "to town",
        "150.00",
        "2026-10-10",
    )
    assert body["account"]["name"] == "MoMo"
    assert body["category"]["name"] == "Transport"
    assert body["version"] == 2
    assert balances(api) == {"Bank": "2000.00", "MoMo": "150.00", "Cash": "0.00"}


def test_edit_with_a_stale_version_is_refused(api):
    created = add_expense(api).json()
    api.patch(f"{TX}/{created['id']}", json={"version": 1, "name": "First"})
    stale = api.patch(f"{TX}/{created['id']}", json={"version": 1, "name": "Second"})
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "stale_version"
    assert api.get(f"{TX}/{created['id']}").json()["name"] == "First"


def test_edit_requires_the_version(api):
    created = add_expense(api).json()
    assert api.patch(f"{TX}/{created['id']}", json={"name": "x"}).status_code == 422


def test_the_type_cannot_be_changed(api):
    created = add_expense(api).json()
    response = api.patch(f"{TX}/{created['id']}", json={"version": 1, "type": "income"})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "type_immutable"
    same = api.patch(f"{TX}/{created['id']}", json={"version": 1, "type": "expense"})
    assert same.status_code == 200


def test_edit_validation(api):
    created = add_expense(api).json()
    cats = categories(api)
    path = f"{TX}/{created['id']}"
    assert api.patch(path, json={"version": 1, "amount": "0"}).status_code == 422
    mismatch = api.patch(path, json={"version": 1, "category_id": cats[("income", "Salary")]})
    assert mismatch.json()["error"]["code"] == "category_type_mismatch"
    assert api.patch(path, json={"version": 1, "category_id": None}).status_code == 422
    early = api.patch(path, json={"version": 1, "transaction_date": "2026-09-01"})
    assert early.json()["error"]["code"] == "before_opening_date"
    assert api.get(path).json()["version"] == 1  # nothing was applied


def test_income_category_can_be_cleared(api):
    created = add_income(api).json()
    response = api.patch(f"{TX}/{created['id']}", json={"version": 1, "category_id": None})
    assert response.status_code == 200
    assert response.json()["category"] is None


def test_archived_account_rules_apply_only_to_changed_references(api):
    created = add_expense(api, "Cash", "10.00").json()
    cash = account_id(api, "Cash")
    api.post(f"{ACCOUNTS}/{cash}/archive")
    path = f"{TX}/{created['id']}"
    assert api.patch(path, json={"version": 1, "name": "Renamed"}).status_code == 200  # unchanged
    moved = api.patch(path, json={"version": 2, "account_id": cash})
    assert moved.status_code == 200  # same archived account, not a change
    momo = account_id(api, "MoMo")
    api.post(f"{ACCOUNTS}/{momo}/archive")
    into_archived = api.patch(path, json={"version": 3, "account_id": momo})
    assert into_archived.status_code == 422
    assert into_archived.json()["error"]["code"] == "account_archived"


def test_delete_removes_the_entry_and_restores_the_balance(api):
    created = add_expense(api, "Bank", "100.00").json()
    assert balances(api)["Bank"] == "1900.00"
    assert api.delete(f"{TX}/{created['id']}").status_code == 204
    assert balances(api)["Bank"] == "2000.00"
    assert api.get(f"{TX}/{created['id']}").status_code == 404
    assert api.delete(f"{TX}/{created['id']}").status_code == 404


def test_requires_a_session(auth_client):
    auth_client.cookies.clear()
    assert auth_client.get("/api/v1/categories").status_code == 401
    assert auth_client.post(f"{TX}/income", json={}).status_code == 401
