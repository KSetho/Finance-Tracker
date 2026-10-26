import logging

import pytest
from sqlalchemy import func, select

from app.core.security import hash_token
from app.models import Account, Category, DataWipeToken, Transaction, User
from app.models import Session as SessionRow
from app.services.category_service import DEFAULT_CATEGORIES
from tests.conftest import OWNER_EMAIL, OWNER_PASSWORD

REQUEST = "/api/v1/data-wipe/request"
CONFIRM = "/api/v1/data-wipe/confirm"


class RecordingSender:
    def __init__(self, error: Exception | None = None):
        self.error = error
        self.wipe_messages: list[tuple[str, str, int]] = []

    def send_password_reset(self, recipient: str, reset_url: str, expiry_minutes: int) -> None:
        raise AssertionError("password reset should not be called")

    def send_data_wipe_code(self, recipient: str, code: str, expiry_minutes: int) -> None:
        if self.error:
            raise self.error
        self.wipe_messages.append((recipient, code, expiry_minutes))

    def send_transaction_csv_report(self, recipient: str, **kwargs) -> None:
        raise AssertionError("transaction csv report should not be called")


def install_sender(client, sender=None) -> RecordingSender:
    sender = sender or RecordingSender()
    client.app.state.password_reset_sender = sender
    return sender


@pytest.fixture
def client(make_client):
    return make_client(email_provider="smtp")


def latest_code(sender: RecordingSender) -> str:
    return sender.wipe_messages[-1][1]


def test_request_requires_auth(client):
    assert client.post(REQUEST).status_code == 401


def test_request_requires_email_provider(make_client, owner):
    client = make_client(email_provider="disabled")
    login = client.post(
        "/api/v1/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}
    )
    client.headers["X-CSRF-Token"] = login.json()["csrf_token"]
    response = client.post(REQUEST)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "service_unavailable"


def test_request_stores_hash_only_and_emails_code(auth_client, owner, db, caplog):
    sender = install_sender(auth_client)
    caplog.set_level(logging.DEBUG)

    response = auth_client.post(REQUEST)

    assert response.status_code == 202
    assert "verification code" in response.json()["message"].lower()
    assert len(sender.wipe_messages) == 1
    recipient, code, expiry = sender.wipe_messages[0]
    row = db.scalar(select(DataWipeToken))
    assert recipient == OWNER_EMAIL
    assert expiry == 10
    assert len(code) == 6 and code.isdigit()
    assert row is not None
    assert row.token_hash == hash_token(code)
    assert code not in row.token_hash
    assert code not in "\n".join(record.getMessage() for record in caplog.records)


def test_confirm_wipes_finance_data_keeps_owner_and_session(
    auth_client, worked_example, db
):
    sender = install_sender(auth_client)
    # Add a budget via API so monthly_budgets is non-empty
    assert (
        auth_client.put(
            "/api/v1/budgets/2026/10",
            json={"allowance": "500.00"},
        ).status_code
        == 200
    )
    food = next(c for c in db.scalars(select(Category)).all() if c.name == "Food")
    bank = worked_example["bank"]
    assert (
        auth_client.post(
            "/api/v1/transactions/expenses",
            json={
                "account_id": str(bank.id),
                "category_id": str(food.id),
                "amount": "25.00",
                "occurred_on": "2026-10-05",
            },
        ).status_code
        == 201
    )

    assert auth_client.post(REQUEST).status_code == 202
    code = latest_code(sender)
    response = auth_client.post(CONFIRM, json={"code": code})

    assert response.status_code == 204
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(User)) == 1
    assert db.scalar(select(func.count()).select_from(Account)) == 0
    assert db.scalar(select(func.count()).select_from(Transaction)) == 0
    assert db.scalar(select(func.count()).select_from(Category)) == len(DEFAULT_CATEGORIES)
    assert auth_client.get("/api/v1/auth/me").status_code == 200
    session = db.scalar(select(SessionRow).where(SessionRow.revoked_at.is_(None)))
    assert session is not None


def test_wrong_code_then_lockout(auth_client, db):
    sender = install_sender(auth_client)
    assert auth_client.post(REQUEST).status_code == 202
    real = latest_code(sender)

    for _ in range(5):
        bad = auth_client.post(CONFIRM, json={"code": "000000"})
        assert bad.status_code == 400
        assert bad.json()["error"]["code"] == "invalid_wipe_code"

    db.expire_all()
    row = db.scalar(select(DataWipeToken))
    assert row is not None and row.consumed_at is not None

    # Even the real code is rejected after lockout
    locked = auth_client.post(CONFIRM, json={"code": real})
    assert locked.status_code == 400


def test_expired_code_rejected(auth_client, clock):
    sender = install_sender(auth_client)
    assert auth_client.post(REQUEST).status_code == 202
    code = latest_code(sender)
    clock.advance(minutes=11)
    response = auth_client.post(CONFIRM, json={"code": code})
    assert response.status_code == 400


def test_request_throttled_after_max(auth_client):
    sender = install_sender(auth_client)
    for _ in range(3):
        assert auth_client.post(REQUEST).status_code == 202
    limited = auth_client.post(REQUEST)
    assert limited.status_code == 429
    assert limited.json()["error"]["code"] == "too_many_attempts"
    assert len(sender.wipe_messages) == 3


def test_new_request_invalidates_previous_code(auth_client):
    sender = install_sender(auth_client)
    assert auth_client.post(REQUEST).status_code == 202
    old = latest_code(sender)
    assert auth_client.post(REQUEST).status_code == 202
    new = latest_code(sender)
    assert old != new
    assert auth_client.post(CONFIRM, json={"code": old}).status_code == 400
    assert auth_client.post(CONFIRM, json={"code": new}).status_code == 204


def test_email_failure_rolls_back_token(auth_client, db):
    install_sender(auth_client, RecordingSender(error=RuntimeError("smtp down")))
    response = auth_client.post(REQUEST)
    assert response.status_code == 503
    assert db.scalar(select(func.count()).select_from(DataWipeToken)) == 0
