import logging
from urllib.parse import parse_qs, urlsplit

import pytest
from sqlalchemy import select

from app.core.security import hash_token, verify_password
from app.models import PasswordResetToken, User
from app.models import Session as SessionRow
from tests.conftest import FRONTEND_ORIGIN, OWNER_EMAIL, OWNER_PASSWORD

FORGOT = "/api/v1/auth/forgot-password"
RESET = "/api/v1/auth/reset-password"


@pytest.fixture
def client(make_client):
    return make_client(password_reset_enabled=True)


class RecordingSender:
    def __init__(self, error: Exception | None = None):
        self.error = error
        self.messages: list[tuple[str, str, int]] = []

    def send_password_reset(self, recipient: str, reset_url: str, expiry_minutes: int) -> None:
        if self.error:
            raise self.error
        self.messages.append((recipient, reset_url, expiry_minutes))


def install_sender(client, sender=None) -> RecordingSender:
    sender = sender or RecordingSender()
    client.app.state.password_reset_sender = sender
    return sender


def request_reset(client, email=OWNER_EMAIL):
    return client.post(FORGOT, json={"email": email})


def raw_token(sender: RecordingSender) -> str:
    return parse_qs(urlsplit(sender.messages[-1][1]).query)["token"][0]


def test_forgot_password_is_generic_and_stores_only_sha256(client, owner, db, caplog):
    sender = install_sender(client)
    caplog.set_level(logging.DEBUG)

    unknown = request_reset(client, "nobody@example.com")
    known = request_reset(client)

    assert unknown.status_code == known.status_code == 202
    assert unknown.json() == known.json()
    assert len(sender.messages) == 1
    recipient, url, expiry = sender.messages[0]
    token = raw_token(sender)
    row = db.scalar(select(PasswordResetToken))
    assert recipient == OWNER_EMAIL
    assert urlsplit(url).scheme + "://" + urlsplit(url).netloc == FRONTEND_ORIGIN
    assert expiry == 30
    assert row is not None
    assert row.token_hash == hash_token(token)
    assert token not in row.token_hash
    assert token not in "\n".join(record.getMessage() for record in caplog.records)


def test_new_request_invalidates_old_token(client, owner, db):
    sender = install_sender(client)
    request_reset(client)
    old_token = raw_token(sender)
    request_reset(client)
    new_token = raw_token(sender)

    assert (
        client.post(RESET, json={"token": old_token, "password": "new-password"}).status_code == 400
    )
    assert (
        client.post(RESET, json={"token": new_token, "password": "new-password"}).status_code == 204
    )


def test_reset_consumes_token_changes_password_and_revokes_sessions(client, owner, db):
    login = client.post(
        "/api/v1/auth/login",
        json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD},
    )
    assert login.status_code == 200
    sender = install_sender(client)
    request_reset(client)
    token = raw_token(sender)

    response = client.post(
        RESET,
        json={"token": token, "password": "1234567"},
    )

    assert response.status_code == 204
    db.expire_all()
    user = db.scalar(select(User))
    reset_row = db.scalar(select(PasswordResetToken))
    session = db.scalar(select(SessionRow))
    assert user is not None and verify_password(user.password_hash, "1234567")
    assert reset_row is not None and reset_row.consumed_at is not None
    assert session is not None and session.revoked_at is not None
    assert client.get("/api/v1/auth/me").status_code == 401
    assert (
        client.post(RESET, json={"token": token, "password": "another-password"}).status_code == 400
    )


@pytest.mark.parametrize("password", ["", "123456"])
def test_reset_rejects_passwords_below_seven_characters(client, password):
    response = client.post(RESET, json={"token": "token", "password": password})
    assert response.status_code == 422


def test_expired_token_is_rejected(client, owner, clock):
    sender = install_sender(client)
    request_reset(client)
    token = raw_token(sender)
    clock.advance(minutes=30)
    response = client.post(RESET, json={"token": token, "password": "1234567"})
    assert response.status_code == 400


def test_request_rate_is_limited_to_three_emails_per_window(client, owner, clock):
    sender = install_sender(client)
    responses = [request_reset(client) for _ in range(4)]
    assert all(response.status_code == 202 for response in responses)
    assert len(sender.messages) == 3

    clock.advance(minutes=15, seconds=1)
    assert request_reset(client).status_code == 202
    assert len(sender.messages) == 4


def test_smtp_failure_is_hidden_and_token_is_invalidated(client, owner, db):
    install_sender(client, RecordingSender(RuntimeError("mail unavailable")))
    response = request_reset(client)
    assert response.status_code == 202
    assert response.json()["message"].startswith("If the account exists")
    row = db.scalar(select(PasswordResetToken))
    assert row is not None and row.consumed_at is not None
