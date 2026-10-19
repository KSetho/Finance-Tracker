from sqlalchemy import select

from app.models import Session as SessionRow
from tests.conftest import OWNER_EMAIL, OWNER_PASSWORD

LOGIN = "/api/v1/auth/login"
LOGOUT = "/api/v1/auth/logout"
ME = "/api/v1/auth/me"


def sign_in(client):
    response = client.post(LOGIN, json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD})
    assert response.status_code == 200
    return response.json()["csrf_token"], client.cookies.get("finance_session")


def session_rows(db):
    db.expire_all()
    return db.scalars(select(SessionRow).order_by(SessionRow.created_at)).all()


def test_logout_revokes_session_and_clears_cookie(client, make_owner, db):
    make_owner()
    csrf, token = sign_in(client)
    response = client.post(LOGOUT, headers={"X-CSRF-Token": csrf})
    assert response.status_code == 204
    set_cookie = response.headers["set-cookie"].lower()
    assert "finance_session=" in set_cookie
    assert "max-age=0" in set_cookie or "expires=" in set_cookie
    assert all(row.revoked_at is not None for row in session_rows(db))
    # replaying the old cookie must fail
    client.cookies.set("finance_session", token)
    assert client.get(ME).status_code == 401


def test_session_older_than_absolute_lifetime_is_refused(make_client, make_owner, clock):
    make_owner()
    client = make_client(session_idle_hours=24 * 30)  # isolate the absolute limit
    sign_in(client)
    clock.advance(days=6, hours=23)
    assert client.get(ME).status_code == 200
    clock.advance(hours=1, seconds=1)
    assert client.get(ME).status_code == 401


def test_idle_session_is_refused(client, make_owner, clock):
    make_owner()
    sign_in(client)
    clock.advance(hours=23)
    assert client.get(ME).status_code == 200
    # last activity was 23h ago; stay idle past the 24h limit
    clock.advance(hours=24, seconds=1)
    assert client.get(ME).status_code == 401


def test_activity_keeps_a_session_alive_within_the_idle_window(client, make_owner, clock):
    make_owner()
    sign_in(client)
    for _ in range(3):
        clock.advance(hours=23)
        assert client.get(ME).status_code == 200


def test_last_seen_is_refreshed_at_most_every_five_minutes(client, make_owner, clock, db):
    make_owner()
    sign_in(client)
    login_time = clock.now()
    clock.advance(minutes=2)
    client.get(ME)
    assert session_rows(db)[0].last_seen_at == login_time
    clock.advance(minutes=4)  # 6 minutes after the last refresh
    client.get(ME)
    assert session_rows(db)[0].last_seen_at == clock.now()


def test_revoking_one_session_leaves_others_valid(make_client, make_owner):
    make_owner()
    first, second = make_client(), make_client()
    csrf, _ = sign_in(first)
    sign_in(second)
    assert first.post(LOGOUT, headers={"X-CSRF-Token": csrf}).status_code == 204
    assert first.get(ME).status_code == 401
    assert second.get(ME).status_code == 200


def test_dead_sessions_are_purged_on_login(make_client, make_owner, clock, db):
    make_owner()
    first = make_client()
    csrf, _ = sign_in(first)
    first.post(LOGOUT, headers={"X-CSRF-Token": csrf})
    assert len(session_rows(db)) == 1  # revoked row still present
    clock.advance(minutes=1)
    sign_in(make_client())
    rows = session_rows(db)
    assert len(rows) == 1
    assert rows[0].revoked_at is None
