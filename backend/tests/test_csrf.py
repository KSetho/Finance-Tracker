from tests.conftest import FRONTEND_ORIGIN, OWNER_EMAIL, OWNER_PASSWORD

LOGIN = "/api/v1/auth/login"
LOGOUT = "/api/v1/auth/logout"
ME = "/api/v1/auth/me"
EVIL = "https://evil.example"


def sign_in(client):
    response = client.post(LOGIN, json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD})
    assert response.status_code == 200
    return response.json()["csrf_token"]


def test_logout_without_csrf_token_is_rejected(client, make_owner):
    make_owner()
    sign_in(client)
    response = client.post(LOGOUT)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "csrf_failed"
    assert client.get(ME).status_code == 200  # session untouched


def test_logout_with_wrong_csrf_token_is_rejected(client, make_owner):
    make_owner()
    sign_in(client)
    response = client.post(LOGOUT, headers={"X-CSRF-Token": "0" * 64})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "csrf_failed"


def test_logout_with_token_from_login_succeeds(client, make_owner):
    make_owner()
    csrf = sign_in(client)
    assert client.post(LOGOUT, headers={"X-CSRF-Token": csrf}).status_code == 204


def test_logout_with_token_from_me_succeeds(client, make_owner):
    make_owner()
    sign_in(client)
    csrf = client.get(ME).json()["csrf_token"]
    assert client.post(LOGOUT, headers={"X-CSRF-Token": csrf}).status_code == 204


def test_token_from_another_session_is_rejected(make_client, make_owner):
    make_owner()
    first, second = make_client(), make_client()
    sign_in(first)
    other_token = sign_in(second)
    assert first.post(LOGOUT, headers={"X-CSRF-Token": other_token}).status_code == 403


def test_logout_without_session_is_unauthenticated_before_csrf(client, make_owner):
    make_owner()
    assert client.post(LOGOUT).status_code == 401


def test_foreign_origin_is_rejected_on_logout(client, make_owner):
    make_owner()
    csrf = sign_in(client)
    response = client.post(LOGOUT, headers={"Origin": EVIL, "X-CSRF-Token": csrf})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "origin_not_allowed"


def test_foreign_origin_is_rejected_on_login_even_with_valid_credentials(client, make_owner):
    make_owner()
    response = client.post(
        LOGIN,
        json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD},
        headers={"Origin": EVIL},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "origin_not_allowed"
    assert "finance_session" not in client.cookies


def test_null_origin_is_rejected(client, make_owner):
    make_owner()
    response = client.post(
        LOGIN, json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, headers={"Origin": "null"}
    )
    assert response.status_code == 403


def test_referer_is_used_when_origin_is_missing(client, make_owner):
    make_owner()
    del client.headers["origin"]
    ok = client.post(
        LOGIN,
        json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD},
        headers={"Referer": f"{FRONTEND_ORIGIN}/login"},
    )
    assert ok.status_code == 200
    bad = client.post(
        LOGIN,
        json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD},
        headers={"Referer": f"{EVIL}/login"},
    )
    assert bad.status_code == 403


def test_unsafe_request_with_no_origin_or_referer_is_rejected(client, make_owner):
    make_owner()
    del client.headers["origin"]
    response = client.post(LOGIN, json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "origin_not_allowed"


def test_referer_lookalike_host_is_rejected(client, make_owner):
    make_owner()
    del client.headers["origin"]
    response = client.post(
        LOGIN,
        json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD},
        headers={"Referer": f"{FRONTEND_ORIGIN}.evil.example/login"},
    )
    assert response.status_code == 403


def test_safe_methods_are_not_subject_to_origin_or_csrf_checks(client, make_owner):
    make_owner()
    sign_in(client)
    assert client.get(ME, headers={"Origin": EVIL}).status_code == 200


def test_all_finance_mutations_require_csrf(auth_client):
    first = auth_client.post(
        "/api/v1/accounts",
        json={
            "name": "Bank",
            "account_type": "bank",
            "opening_balance": "100.00",
            "opening_date": "2026-10-01",
        },
    ).json()
    second = auth_client.post(
        "/api/v1/accounts",
        json={
            "name": "Cash",
            "account_type": "cash",
            "opening_balance": "0.00",
            "opening_date": "2026-10-01",
        },
    ).json()
    del auth_client.headers["X-CSRF-Token"]

    requests = [
        auth_client.post(
            "/api/v1/accounts",
            json={
                "name": "MoMo",
                "account_type": "mobile_money",
                "opening_date": "2026-10-01",
            },
        ),
        auth_client.post(
            "/api/v1/transactions/income",
            json={
                "name": "Salary",
                "amount": "10.00",
                "transaction_date": "2026-10-17",
                "account_id": first["id"],
            },
        ),
        auth_client.post(
            "/api/v1/transfers",
            json={
                "name": "Move cash",
                "amount": "10.00",
                "transaction_date": "2026-10-17",
                "source_account_id": first["id"],
                "destination_account_id": second["id"],
            },
        ),
        auth_client.put("/api/v1/budgets/2026/10", json={"allowance": "100.00"}),
    ]

    for response in requests:
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "csrf_failed"
    assert auth_client.get("/api/v1/accounts").status_code == 200
