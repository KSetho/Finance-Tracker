import uuid

import pytest

ACCOUNTS = "/api/v1/accounts"
TX = "/api/v1/transactions"
TRANSFERS = "/api/v1/transfers"


def account_ids(client):
    return {
        a["name"]: a["id"]
        for a in client.get(ACCOUNTS, params={"include_archived": "true"}).json()["items"]
    }


def balances(client):
    return {a["name"]: a["balance"] for a in client.get(ACCOUNTS).json()["items"]}


def transfer(client, source="Bank", destination="MoMo", amount="500.00", **extra):
    ids = account_ids(client)
    body = {
        "name": f"{source} to {destination}",
        "amount": amount,
        "transaction_date": "2026-10-05",
        "source_account_id": ids[source],
        "destination_account_id": ids[destination],
        **extra,
    }
    for key in ("fee_account",):
        if key in body:
            body["fee_account_id"] = ids[body.pop(key)]
    return client.post(TRANSFERS, json=body)


def listing(client, **params):
    response = client.get(TX, params={"page_size": 100, **params})
    assert response.status_code == 200
    return response.json()["items"]


@pytest.fixture
def api(auth_client, worked_example):
    return auth_client


def test_transfer_without_a_fee_moves_the_principal_once(api):
    response = transfer(api)
    assert response.status_code == 201
    body = response.json()
    assert body["type"] == "transfer"
    assert body["account"]["name"] == "Bank"
    assert body["destination_account"]["name"] == "MoMo"
    assert (body["amount"], body["fee_amount"], body["fee"], body["category"]) == (
        "500.00",
        "0.00",
        None,
        None,
    )
    assert balances(api) == {"Bank": "1500.00", "MoMo": "800.00", "Cash": "0.00"}
    assert len(listing(api)) == 1  # no fee row
    assert listing(api, type="income") == [] and listing(api, type="expense") == []


def test_the_worked_example_matches_exactly(api):
    transfer(api, "Bank", "MoMo", "500.00")
    withdrawal = transfer(api, "MoMo", "Cash", "500.00", fee_amount="5.00", fee_account="MoMo")
    assert withdrawal.status_code == 201
    assert balances(api) == {"Bank": "1500.00", "MoMo": "295.00", "Cash": "500.00"}
    assert api.get(ACCOUNTS).json()["combined_balance"] == "2295.00"
    expenses = listing(api, type="expense")
    assert [e["amount"] for e in expenses] == ["5.00"]
    assert expenses[0]["is_fee"] is True
    assert listing(api, type="income") == []


@pytest.mark.parametrize(
    ("charged", "expected"),
    [
        ("MoMo", {"Bank": "1900.00", "MoMo": "398.00", "Cash": "0.00"}),  # destination
        ("Bank", {"Bank": "1898.00", "MoMo": "400.00", "Cash": "0.00"}),  # source
    ],
)
def test_the_fee_is_deducted_from_the_chosen_account(api, charged, expected):
    assert transfer(api, amount="100.00", fee_amount="2.00", fee_account=charged).status_code == 201
    assert balances(api) == expected


def test_the_fee_is_one_linked_expense_in_the_fees_category(api):
    parent = transfer(api, amount="500.00", fee_amount="5.00", fee_account="MoMo").json()
    fee = parent["fee"]
    assert fee["amount"] == "5.00"
    assert fee["account"]["name"] == "MoMo"
    assert fee["id"] == str(uuid.uuid5(uuid.UUID(parent["id"]), "fee"))
    assert parent["fee_amount"] == "5.00"

    rows = {row["id"]: row for row in listing(api)}
    assert len(rows) == 2
    row = rows[fee["id"]]
    assert row["type"] == "expense"
    assert row["is_fee"] is True
    assert row["related_transaction_id"] == parent["id"]
    assert row["category"]["name"] == "Fees"
    assert row["transaction_date"] == parent["transaction_date"]
    assert row["name"] == "Fee: Bank to MoMo"
    assert row["fee_amount"] == "0.00" and row["fee"] is None


def test_a_zero_fee_creates_no_fee_row(api):
    transfer(api, fee_amount="0.00")
    assert len(listing(api)) == 1


def test_the_fee_defaults_to_the_source_account(api):
    parent = transfer(api, amount="100.00", fee_amount="2.00").json()
    assert parent["fee"]["account"]["name"] == "Bank"
    assert balances(api)["Bank"] == "1898.00"


def test_a_fee_account_that_is_neither_source_nor_destination_is_refused(api):
    response = transfer(api, fee_amount="2.00", fee_account="Cash")
    assert response.status_code == 422
    assert balances(api) == {"Bank": "2000.00", "MoMo": "300.00", "Cash": "0.00"}
    assert listing(api) == []


def test_source_and_destination_must_differ(api):
    response = transfer(api, "Bank", "Bank")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "same_account"


@pytest.mark.parametrize(
    "override",
    [
        {"amount": "0"},
        {"amount": "-5.00"},
        {"amount": "1.234"},
        {"fee_amount": "-1.00"},
        {"fee_amount": "1.234"},
        {"name": ""},
        {"transaction_date": "nope"},
    ],
)
def test_invalid_input_is_refused_and_changes_nothing(api, override):
    response = transfer(api, **override)
    assert response.status_code == 422
    assert response.json()["error"]["code"] in {"validation_error"}
    assert balances(api)["Bank"] == "2000.00" and listing(api) == []


def test_unknown_and_archived_accounts(api):
    ids = account_ids(api)
    unknown = api.post(
        TRANSFERS,
        json={
            "name": "x",
            "amount": "1.00",
            "transaction_date": "2026-10-05",
            "source_account_id": ids["Bank"],
            "destination_account_id": str(uuid.uuid4()),
        },
    )
    assert unknown.status_code == 404
    api.post(f"{ACCOUNTS}/{ids['Cash']}/archive")
    archived = transfer(api, "Bank", "Cash")
    assert archived.status_code == 422
    assert archived.json()["error"]["code"] == "account_archived"


def test_the_date_must_not_precede_either_accounts_opening_date(api):
    response = transfer(api, transaction_date="2026-09-30")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "before_opening_date"


def test_editing_updates_both_balances_and_the_fee_together(api):
    parent = transfer(api, amount="500.00", fee_amount="5.00", fee_account="MoMo").json()
    ids = account_ids(api)
    response = api.patch(
        f"{TRANSFERS}/{parent['id']}",
        json={
            "version": 1,
            "amount": "300.00",
            "destination_account_id": ids["Cash"],
            "fee_amount": "3.00",
            "fee_account_id": ids["Cash"],
            "transaction_date": "2026-10-08",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["version"] == 2
    assert body["destination_account"]["name"] == "Cash"
    assert (body["fee"]["amount"], body["fee"]["account"]["name"]) == ("3.00", "Cash")
    assert balances(api) == {"Bank": "1700.00", "MoMo": "300.00", "Cash": "297.00"}
    fee_row = next(row for row in listing(api) if row["is_fee"])
    assert (fee_row["amount"], fee_row["transaction_date"], fee_row["account"]["name"]) == (
        "3.00",
        "2026-10-08",
        "Cash",
    )
    assert len(listing(api)) == 2


def test_the_fee_follows_the_parents_date_and_name(api):
    parent = transfer(api, fee_amount="5.00", fee_account="MoMo").json()
    api.patch(
        f"{TRANSFERS}/{parent['id']}",
        json={"version": 1, "name": "Float top-up", "transaction_date": "2026-10-12"},
    )
    fee_row = next(row for row in listing(api) if row["is_fee"])
    assert fee_row["transaction_date"] == "2026-10-12"
    assert fee_row["name"] == "Fee: Float top-up"


def test_setting_the_fee_to_zero_removes_it_and_setting_it_again_recreates_it(api):
    parent = transfer(api, amount="500.00", fee_amount="5.00", fee_account="MoMo").json()
    removed = api.patch(f"{TRANSFERS}/{parent['id']}", json={"version": 1, "fee_amount": "0.00"})
    assert removed.status_code == 200
    assert removed.json()["fee"] is None
    assert balances(api) == {"Bank": "1500.00", "MoMo": "800.00", "Cash": "0.00"}
    assert len(listing(api)) == 1

    back = api.patch(f"{TRANSFERS}/{parent['id']}", json={"version": 2, "fee_amount": "4.00"})
    assert back.status_code == 200
    assert back.json()["fee"]["amount"] == "4.00"
    assert back.json()["fee"]["account"]["name"] == "Bank"  # defaults to the source
    assert balances(api)["Bank"] == "1496.00"
    assert len([row for row in listing(api) if row["is_fee"]]) == 1


def test_an_edit_that_leaves_the_fee_account_invalid_is_refused(api):
    parent = transfer(api, fee_amount="5.00", fee_account="MoMo").json()
    ids = account_ids(api)
    response = api.patch(
        f"{TRANSFERS}/{parent['id']}", json={"version": 1, "destination_account_id": ids["Cash"]}
    )
    assert response.status_code == 422
    assert api.get(f"{TRANSFERS}/{parent['id']}").json()["version"] == 1
    assert balances(api)["Cash"] == "0.00"


def test_editing_with_a_stale_version_is_refused(api):
    parent = transfer(api).json()
    api.patch(f"{TRANSFERS}/{parent['id']}", json={"version": 1, "name": "One"})
    stale = api.patch(f"{TRANSFERS}/{parent['id']}", json={"version": 1, "name": "Two"})
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "stale_version"


def test_deleting_removes_the_fee_and_restores_balances(api):
    parent = transfer(api, fee_amount="5.00", fee_account="MoMo").json()
    assert api.delete(f"{TRANSFERS}/{parent['id']}").status_code == 204
    assert balances(api) == {"Bank": "2000.00", "MoMo": "300.00", "Cash": "0.00"}
    assert listing(api) == []
    assert api.get(f"{TX}/{parent['fee']['id']}").status_code == 404
    assert api.delete(f"{TRANSFERS}/{parent['id']}").status_code == 404


def test_the_generic_transaction_endpoints_handle_transfers_too(api):
    parent = transfer(api, fee_amount="5.00", fee_account="MoMo").json()
    renamed = api.patch(f"{TX}/{parent['id']}", json={"version": 1, "name": "Renamed"})
    assert renamed.status_code == 200 and renamed.json()["type"] == "transfer"
    assert api.get(f"{TX}/{parent['id']}").json()["destination_account"]["name"] == "MoMo"
    assert api.delete(f"{TX}/{parent['id']}").status_code == 204
    assert listing(api) == []


def test_the_transfer_endpoints_reject_other_types(api):
    ids = account_ids(api)
    cats = {c["name"]: c["id"] for c in api.get("/api/v1/categories").json()["items"]}
    expense = api.post(
        f"{TX}/expenses",
        json={
            "name": "x",
            "amount": "1.00",
            "transaction_date": "2026-10-05",
            "account_id": ids["Bank"],
            "category_id": cats["Food"],
        },
    ).json()
    assert api.get(f"{TRANSFERS}/{expense['id']}").status_code == 404
    assert api.patch(f"{TRANSFERS}/{expense['id']}", json={"version": 1}).status_code == 404
    assert api.delete(f"{TRANSFERS}/{expense['id']}").status_code == 404


def test_get_a_transfer_with_its_fee(api):
    parent = transfer(api, fee_amount="5.00", fee_account="MoMo").json()
    fetched = api.get(f"{TRANSFERS}/{parent['id']}")
    assert fetched.status_code == 200
    assert fetched.json() == parent


def test_retry_with_the_same_id_creates_one_transfer_and_one_fee(api):
    key = str(uuid.uuid4())
    first = transfer(api, fee_amount="5.00", fee_account="MoMo", id=key)
    second = transfer(api, fee_amount="5.00", fee_account="MoMo", id=key)
    assert (first.status_code, second.status_code) == (201, 200)
    assert first.json()["id"] == second.json()["id"] == key
    assert len(listing(api)) == 2
    assert balances(api) == {"Bank": "1500.00", "MoMo": "795.00", "Cash": "0.00"}  # applied once


def test_reusing_an_id_for_different_fields_is_a_conflict(api):
    key = str(uuid.uuid4())
    transfer(api, id=key)
    response = transfer(api, id=key, amount="999.00")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "id_conflict"


def test_archived_accounts_do_not_block_unrelated_edits(api):
    parent = transfer(api).json()
    api.post(f"{ACCOUNTS}/{account_ids(api)['MoMo']}/archive")
    assert (
        api.patch(f"{TRANSFERS}/{parent['id']}", json={"version": 1, "name": "Kept"}).status_code
        == 200
    )


def test_requires_a_session(auth_client):
    auth_client.cookies.clear()
    assert auth_client.post(TRANSFERS, json={}).status_code == 401
    assert auth_client.get(f"{TRANSFERS}/{uuid.uuid4()}").status_code == 401
