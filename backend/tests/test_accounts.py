import uuid

import pytest
from sqlalchemy import func, select

from app.models import Transaction

URL = "/api/v1/accounts"


def create(client, name="Bank", account_type="bank", opening_balance="2000.00", **extra):
    body = {
        "name": name,
        "account_type": account_type,
        "opening_balance": opening_balance,
        "opening_date": "2026-10-01",
        **extra,
    }
    return client.post(URL, json=body)


def test_create_returns_201_with_balance_and_makes_no_transaction(auth_client, db):
    response = create(auth_client, "MTN MoMo", "mobile_money", "300.00")
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "MTN MoMo"
    assert body["account_type"] == "mobile_money"
    assert body["opening_balance"] == "300.00"
    assert body["balance"] == "300.00"
    assert body["opening_date"] == "2026-10-01"
    assert body["is_archived"] is False
    assert db.scalar(select(func.count()).select_from(Transaction)) == 0  # not income


def test_opening_balance_defaults_to_zero(auth_client):
    response = auth_client.post(
        URL, json={"name": "Cash", "account_type": "cash", "opening_date": "2026-10-01"}
    )
    assert response.status_code == 201
    assert response.json()["balance"] == "0.00"


def test_name_is_trimmed(auth_client):
    assert create(auth_client, "  Bank  ").json()["name"] == "Bank"


def test_list_shows_balances_and_the_combined_total_of_active_accounts(auth_client, clock):
    for name, kind, opening in (
        ("Bank", "bank", "2000.00"),
        ("MoMo", "mobile_money", "300.00"),
        ("Cash", "cash", "0.00"),
    ):
        create(auth_client, name, kind, opening)
        clock.advance(seconds=1)
    body = auth_client.get(URL).json()
    assert [a["name"] for a in body["items"]] == ["Bank", "MoMo", "Cash"]  # creation order
    assert [a["balance"] for a in body["items"]] == ["2000.00", "300.00", "0.00"]
    assert body["combined_balance"] == "2300.00"


def test_archived_accounts_leave_the_list_and_the_total_but_keep_their_row(auth_client, db):
    bank = create(auth_client, "Bank", "bank", "2000.00").json()
    create(auth_client, "Cash", "cash", "100.00")
    archived = auth_client.post(f"{URL}/{bank['id']}/archive")
    assert archived.status_code == 200
    assert archived.json()["is_archived"] is True

    body = auth_client.get(URL).json()
    assert [a["name"] for a in body["items"]] == ["Cash"]
    assert body["combined_balance"] == "100.00"

    everything = auth_client.get(URL, params={"include_archived": "true"}).json()
    assert {a["name"] for a in everything["items"]} == {"Bank", "Cash"}
    assert everything["combined_balance"] == "100.00"  # archived never counts
    assert auth_client.get(f"{URL}/{bank['id']}").json()["balance"] == "2000.00"


def test_archiving_twice_is_harmless(auth_client):
    account = create(auth_client).json()
    assert auth_client.post(f"{URL}/{account['id']}/archive").status_code == 200
    assert auth_client.post(f"{URL}/{account['id']}/archive").status_code == 200


def test_rename_and_get(auth_client):
    account = create(auth_client, "Bank").json()
    response = auth_client.patch(f"{URL}/{account['id']}", json={"name": "GCB Bank"})
    assert response.status_code == 200
    assert auth_client.get(f"{URL}/{account['id']}").json()["name"] == "GCB Bank"


def test_editing_opening_balance_and_date_recalculates_the_balance(auth_client):
    account = create(auth_client, "Bank", opening_balance="300.00").json()
    response = auth_client.patch(
        f"{URL}/{account['id']}", json={"opening_balance": "500.00", "opening_date": "2026-09-15"}
    )
    assert response.status_code == 200
    body = response.json()
    assert (body["opening_balance"], body["balance"], body["opening_date"]) == (
        "500.00",
        "500.00",
        "2026-09-15",
    )


def test_patch_cannot_change_archive_state(auth_client):
    account = create(auth_client).json()
    auth_client.patch(f"{URL}/{account['id']}", json={"is_archived": True})
    assert auth_client.get(f"{URL}/{account['id']}").json()["is_archived"] is False


@pytest.mark.parametrize(
    "override",
    [
        {"name": ""},
        {"name": "   "},
        {"name": "x" * 81},
        {"opening_balance": "-1.00"},
        {"opening_balance": "1.234"},
        {"opening_balance": "abc"},
        {"account_type": "savings"},
        {"opening_date": "2026-13-45"},
        {"opening_date": "yesterday"},
    ],
)
def test_invalid_input_returns_422(auth_client, override):
    body = {
        "name": "Bank",
        "account_type": "bank",
        "opening_balance": "1.00",
        "opening_date": "2026-10-01",
        **override,
    }
    response = auth_client.post(URL, json=body)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    assert auth_client.get(URL).json()["items"] == []


def test_duplicate_names_are_refused_ignoring_case(auth_client):
    create(auth_client, "Bank")
    response = create(auth_client, "bank")
    assert response.status_code == 422
    assert "name" in response.json()["error"]["message"].lower()


def test_renaming_to_an_existing_name_is_refused(auth_client):
    create(auth_client, "Bank")
    other = create(auth_client, "Cash", "cash").json()
    assert auth_client.patch(f"{URL}/{other['id']}", json={"name": "BANK"}).status_code == 422


def test_retry_with_same_id_and_fields_returns_the_existing_account(auth_client):
    key = str(uuid.uuid4())
    first = create(auth_client, id=key)
    second = create(auth_client, id=key)
    assert (first.status_code, second.status_code) == (201, 200)
    assert first.json()["id"] == second.json()["id"] == key
    assert len(auth_client.get(URL).json()["items"]) == 1


def test_reusing_an_id_for_different_fields_is_a_conflict(auth_client):
    key = str(uuid.uuid4())
    create(auth_client, id=key)
    response = create(auth_client, "Other", "cash", "5.00", id=key)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "id_conflict"


def test_unknown_account_is_404_and_bad_ids_are_422(auth_client):
    missing = auth_client.get(f"{URL}/{uuid.uuid4()}")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "not_found"
    assert auth_client.get(f"{URL}/not-a-uuid").status_code == 422
    assert auth_client.post(f"{URL}/{uuid.uuid4()}/archive").status_code == 404
    assert auth_client.patch(f"{URL}/{uuid.uuid4()}", json={"name": "x"}).status_code == 404


def test_requires_a_session(client):
    assert client.get(URL).status_code == 401
    assert client.post(URL, json={}).status_code == 401
