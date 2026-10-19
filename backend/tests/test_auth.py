from sqlalchemy import select

from app.core.security import csrf_token_for, hash_token
from app.models import Session as SessionRow
from tests.conftest import FRONTEND_ORIGIN, OWNER_EMAIL, OWNER_PASSWORD, SECRET_KEY

LOGIN = "/api/v1/auth/login"
ME = "/api/v1/auth/me"


def login(client, email=OWNER_EMAIL, password=OWNER_PASSWORD, **kwargs):
    return client.post(LOGIN, json={"email": email, "password": password}, **kwargs)


def test_login_success_returns_user_csrf_and_expiry(client, make_owner, clock):
    owner = make_owner()
    response = login(client)
    assert response.status_code == 200
    body = response.json()
    assert body["user"] == {"id": str(owner.id), "email": OWNER_EMAIL}
    token = client.cookies.get("finance_session")
    assert token
    assert body["csrf_token"] == csrf_token_for(token, SECRET_KEY)
    assert body["expires_at"].startswith("2026-10-24T12:00:00")  # 7 days after fake "now"


def test_login_cookie_attributes(client, make_owner):
    make_owner()
    cookie = login(client).headers["set-cookie"].lower()
    assert cookie.startswith("finance_session=")
    assert "httponly" in cookie
    assert "samesite=lax" in cookie
    assert "path=/" in cookie
    assert f"max-age={7 * 24 * 3600}" in cookie
    assert "secure" not in cookie  # development/test over http


def test_login_cookie_is_secure_in_production(make_client, make_owner):
    make_owner()
    origin = "https://finance.example.com"
    client = make_client(app_env="production", frontend_origin=origin)
    response = login(client, headers={"Origin": origin})
    assert response.status_code == 200
    assert "secure" in response.headers["set-cookie"].lower()


def test_login_normalizes_email(client, make_owner):
    make_owner()
    assert login(client, email="  OWNER@Example.COM ").status_code == 200


def test_me_returns_profile_and_csrf_token(client, make_owner):
    owner = make_owner()
    login(client)
    response = client.get(ME)
    assert response.status_code == 200
    body = response.json()
    assert body["user"] == {"id": str(owner.id), "email": OWNER_EMAIL}
    assert body["csrf_token"] == csrf_token_for(client.cookies.get("finance_session"), SECRET_KEY)


def test_me_without_cookie_is_unauthenticated(client, make_owner):
    make_owner()
    response = client.get(ME)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthenticated"


def test_me_with_garbage_cookie_is_unauthenticated(client, make_owner):
    make_owner()
    client.cookies.set("finance_session", "not-a-real-token")
    assert client.get(ME).status_code == 401


def test_only_token_hash_is_stored(client, make_owner, db):
    make_owner()
    login(client)
    token = client.cookies.get("finance_session")
    rows = db.scalars(select(SessionRow)).all()
    assert len(rows) == 1
    assert rows[0].token_hash == hash_token(token)
    assert token not in rows[0].token_hash


def test_origin_header_is_sent_by_default_client(client):
    assert client.headers["origin"] == FRONTEND_ORIGIN


def test_no_secrets_or_credentials_in_logs(client, make_owner, caplog):
    import logging

    caplog.set_level(logging.DEBUG)
    make_owner()
    client.post(LOGIN, json={"email": OWNER_EMAIL, "password": "definitely-wrong-password"})
    csrf, token = None, None
    ok = login(client)
    csrf = ok.json()["csrf_token"]
    token = client.cookies.get("finance_session")
    client.post("/api/v1/auth/logout", headers={"X-CSRF-Token": csrf})
    client.post(LOGIN, json={"email": "stranger@example.com", "password": "another-wrong-password"})

    logged = "\n".join(record.getMessage() for record in caplog.records)
    for secret in (
        OWNER_PASSWORD,
        "definitely-wrong-password",
        "another-wrong-password",
        token,
        csrf,
        SECRET_KEY,
    ):
        assert secret not in logged
    # security events are still recorded, without the credentials
    assert "login_failed" in logged
    assert "login_success" in logged
    assert "logout" in logged
