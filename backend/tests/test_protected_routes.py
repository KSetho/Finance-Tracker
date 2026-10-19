import re
import uuid

from tests.conftest import FRONTEND_ORIGIN

PUBLIC = {
    ("GET", "/api/v1/health"),
    ("POST", "/api/v1/auth/login"),
    ("POST", "/api/v1/auth/forgot-password"),
    ("POST", "/api/v1/auth/reset-password"),
}


def _routes(app):
    """Every (METHOD, path) under /api/v1, read from the OpenAPI schema (routers nest lazily)."""
    for path, operations in app.openapi()["paths"].items():
        if path.startswith("/api/v1"):
            for method in operations:
                yield method.upper(), path


def test_every_non_public_route_requires_a_session(client):
    checked = 0
    for method, path in _routes(client.app):
        if (method, path) in PUBLIC:
            continue
        url = re.sub(r"\{[^}]+\}", str(uuid.uuid4()), path)
        response = client.request(
            method,
            url,
            json={} if method in {"POST", "PUT", "PATCH"} else None,
            headers={"Origin": FRONTEND_ORIGIN},
        )
        assert response.status_code == 401, f"{method} {path} returned {response.status_code}"
        assert response.json()["error"]["code"] == "unauthenticated"
        checked += 1
    assert checked >= 1  # at least /auth/me


def test_no_registration_routes_exist(client):
    forbidden = ("register", "signup")
    for _, path in _routes(client.app):
        assert not any(word in path.lower() for word in forbidden), path


def test_unknown_routes_do_not_leak_data(client):
    response = client.get("/api/v1/transactions")
    assert response.status_code in {401, 404}
    assert response.json()["error"]["code"] in {"unauthenticated", "not_found"}
