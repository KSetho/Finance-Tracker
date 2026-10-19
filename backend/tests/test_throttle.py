import pytest

from app.core import security
from app.services import auth_service
from tests.conftest import OWNER_EMAIL, OWNER_PASSWORD

LOGIN = "/api/v1/auth/login"
WRONG = "wrong-password-123"


def attempt(client, password=WRONG, email=OWNER_EMAIL, ip=None):
    headers = {"X-Forwarded-For": ip} if ip else {}
    return client.post(LOGIN, json={"email": email, "password": password}, headers=headers)


@pytest.fixture
def verify_spy(monkeypatch):
    calls: list[str] = []
    original = security.verify_password

    def spy(password_hash: str, password: str) -> bool:
        calls.append(password_hash)
        return original(password_hash, password)

    monkeypatch.setattr(auth_service, "verify_password", spy)
    return calls


def test_sixth_attempt_from_one_ip_is_throttled_even_with_correct_password(client, make_owner):
    make_owner()
    assert [attempt(client).status_code for _ in range(5)] == [401] * 5
    throttled = attempt(client, password=OWNER_PASSWORD)
    assert throttled.status_code == 429
    assert throttled.json()["error"]["code"] == "too_many_attempts"
    assert 1 <= int(throttled.headers["retry-after"]) <= 15 * 60


def test_throttled_attempts_skip_password_verification(client, make_owner, verify_spy):
    make_owner()
    for _ in range(5):
        attempt(client)
    verify_spy.clear()
    assert attempt(client, password=OWNER_PASSWORD).status_code == 429
    assert verify_spy == []


def test_owner_can_sign_in_after_the_window(client, make_owner, clock):
    make_owner()
    for _ in range(5):
        attempt(client)
    assert attempt(client, password=OWNER_PASSWORD).status_code == 429
    clock.advance(minutes=16)
    assert attempt(client, password=OWNER_PASSWORD).status_code == 200


def test_retry_after_reflects_time_until_oldest_failure_leaves_window(client, make_owner, clock):
    make_owner()
    for _ in range(5):
        attempt(client)
    clock.advance(minutes=10)
    throttled = attempt(client, password=OWNER_PASSWORD)
    assert throttled.status_code == 429
    assert int(throttled.headers["retry-after"]) == 5 * 60


def test_successful_login_clears_the_ips_failures(client, make_owner):
    make_owner()
    for _ in range(4):
        attempt(client)
    assert attempt(client, password=OWNER_PASSWORD).status_code == 200
    statuses = [attempt(client).status_code for _ in range(6)]
    assert statuses == [401] * 5 + [429]


def test_other_ip_is_not_blocked_by_a_throttled_ip(make_client, make_owner):
    make_owner()
    client = make_client(trusted_proxy=True)
    for _ in range(5):
        attempt(client, ip="203.0.113.1")
    assert attempt(client, password=OWNER_PASSWORD, ip="203.0.113.1").status_code == 429
    assert attempt(client, password=OWNER_PASSWORD, ip="203.0.113.2").status_code == 200


def test_account_wide_limit_blocks_all_sources(make_client, make_owner):
    make_owner()
    client = make_client(trusted_proxy=True)
    for i in range(20):
        assert attempt(client, ip=f"198.51.100.{i}").status_code == 401
    blocked = attempt(client, password=OWNER_PASSWORD, ip="192.0.2.99")
    assert blocked.status_code == 429


def test_account_limit_only_counts_attempts_against_the_owner_email(make_client, make_owner):
    make_owner()
    client = make_client(trusted_proxy=True)
    for i in range(20):
        attempt(client, email=f"guess{i}@example.com", ip=f"198.51.100.{i}")
    assert attempt(client, password=OWNER_PASSWORD, ip="192.0.2.99").status_code == 200


def test_forwarded_header_is_ignored_unless_proxy_is_trusted(client, make_owner):
    make_owner()
    statuses = [attempt(client, ip=f"203.0.113.{i}").status_code for i in range(6)]
    assert statuses == [401] * 5 + [429]


def test_forwarded_header_is_used_when_proxy_is_trusted(make_client, make_owner):
    make_owner()
    client = make_client(trusted_proxy=True)
    statuses = [attempt(client, ip=f"203.0.113.{i}").status_code for i in range(6)]
    assert statuses == [401] * 6


def test_limits_are_configurable(make_client, make_owner):
    make_owner()
    client = make_client(login_max_failures_per_ip=2)
    assert [attempt(client).status_code for _ in range(3)] == [401, 401, 429]
