import pytest

from app.core import security
from app.services import auth_service
from tests.conftest import OWNER_EMAIL, OWNER_PASSWORD

LOGIN = "/api/v1/auth/login"


def attempt(client, email, password):
    return client.post(LOGIN, json={"email": email, "password": password})


@pytest.fixture
def verify_spy(monkeypatch):
    calls: list[str] = []
    original = security.verify_password

    def spy(password_hash: str, password: str) -> bool:
        calls.append(password_hash)
        return original(password_hash, password)

    monkeypatch.setattr(auth_service, "verify_password", spy)
    return calls


def test_all_refusals_have_identical_status_and_body(client, make_owner):
    owner = make_owner()
    responses = {
        "wrong_password": attempt(client, OWNER_EMAIL, "wrong-password-123"),
        "unknown_email": attempt(client, "stranger@example.com", OWNER_PASSWORD),
    }
    assert owner  # owner exists, so the cases above exercise real branches
    shapes = {(r.status_code, r.text) for r in responses.values()}
    assert len(shapes) == 1
    status, body = shapes.pop()
    assert status == 401
    assert '"invalid_credentials"' in body


def test_other_email_with_existing_user_record_is_refused(client, make_owner):
    make_owner(email="other@example.com", password=OWNER_PASSWORD)
    refusal = attempt(client, "other@example.com", OWNER_PASSWORD)
    baseline = attempt(client, "nobody@example.com", "whatever-123456")
    assert refusal.status_code == 401
    assert (refusal.status_code, refusal.text) == (baseline.status_code, baseline.text)
    assert "finance_session" not in client.cookies


def test_inactive_owner_is_refused_identically(client, make_owner):
    make_owner(is_active=False)
    inactive = attempt(client, OWNER_EMAIL, OWNER_PASSWORD)
    baseline = attempt(client, "nobody@example.com", "whatever-123456")
    assert (inactive.status_code, inactive.text) == (baseline.status_code, baseline.text)


def test_no_session_cookie_set_on_failure(client, make_owner):
    make_owner()
    response = attempt(client, OWNER_EMAIL, "wrong-password-123")
    assert "set-cookie" not in response.headers


def test_exactly_one_password_verification_on_every_path(client, make_owner, verify_spy):
    make_owner()
    attempt(client, OWNER_EMAIL, OWNER_PASSWORD)  # success
    attempt(client, OWNER_EMAIL, "wrong-password-123")  # wrong password
    attempt(client, "stranger@example.com", OWNER_PASSWORD)  # not the owner's email
    assert len(verify_spy) == 3


def test_dummy_hash_is_used_when_email_is_not_the_owners(client, make_owner, verify_spy):
    owner = make_owner()
    attempt(client, "stranger@example.com", OWNER_PASSWORD)
    assert verify_spy == [security.dummy_hash()]
    assert verify_spy[0] != owner.password_hash


def test_dummy_hash_is_used_when_no_owner_exists(client, verify_spy):
    attempt(client, OWNER_EMAIL, OWNER_PASSWORD)
    assert verify_spy == [security.dummy_hash()]


def test_dummy_hash_is_used_for_inactive_owner(client, make_owner, verify_spy):
    make_owner(is_active=False)
    attempt(client, OWNER_EMAIL, OWNER_PASSWORD)
    assert verify_spy == [security.dummy_hash()]


@pytest.mark.parametrize(
    "payload",
    [
        {"email": "", "password": "x"},
        {"email": "   ", "password": "x"},
        {"email": "a" * 400 + "@example.com", "password": "x"},
        {"email": OWNER_EMAIL, "password": ""},
        {"email": OWNER_EMAIL, "password": "p" * 2000},
        {"email": OWNER_EMAIL},
        {},
    ],
)
def test_invalid_payloads_return_422_not_500(client, make_owner, payload):
    make_owner()
    response = client.post(LOGIN, json=payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_non_json_body_returns_422(client):
    response = client.post(LOGIN, content="not json", headers={"Content-Type": "application/json"})
    assert response.status_code == 422
