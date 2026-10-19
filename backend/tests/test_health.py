HEALTH = "/api/v1/health"


def test_health_is_public_and_minimal(client):
    response = client.get(HEALTH)
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert "set-cookie" not in response.headers


def test_health_exposes_no_version_host_or_configuration(client, settings):
    response = client.get(HEALTH)
    text = response.text + str(dict(response.headers))
    for secret in (settings.owner_email, settings.secret_key, settings.database_url):
        assert secret not in text
    assert "version" not in text.lower()
    assert "x-powered-by" not in response.headers


def test_health_reports_unavailable_when_database_is_down(make_client):
    broken = make_client(database_url="postgresql+psycopg://x:y@127.0.0.1:1/none")
    response = broken.get(HEALTH)
    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}
