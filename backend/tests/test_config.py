import pytest
from pydantic import ValidationError

from app.core.config import Settings, normalize_email


def make_settings(**overrides) -> Settings:
    values = {
        "owner_email": "Owner@Example.com",
        "database_url": "postgresql+psycopg://u:p@localhost:5432/db",
        "secret_key": "k" * 48,
        "frontend_origin": "http://localhost:5173",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def test_normalize_email_trims_and_lowercases():
    assert normalize_email("  Owner@Example.COM \n") == "owner@example.com"


def test_owner_email_is_normalized_on_load():
    assert make_settings(owner_email="  Owner@Example.com ").owner_email == "owner@example.com"


def test_missing_owner_email_fails_startup(monkeypatch):
    monkeypatch.delenv("OWNER_EMAIL", raising=False)
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            database_url="postgresql+psycopg://u:p@localhost/db",
            secret_key="k" * 48,
        )


@pytest.mark.parametrize(
    "bad", ["", "   ", "not-an-email", "a@", "@example.com", "a b@example.com"]
)
def test_malformed_owner_email_fails_startup(bad):
    with pytest.raises(ValidationError):
        make_settings(owner_email=bad)


def test_short_secret_key_fails_startup():
    with pytest.raises(ValidationError):
        make_settings(secret_key="k" * 31)


def test_production_requires_https_frontend_origin():
    with pytest.raises(ValidationError):
        make_settings(app_env="production", frontend_origin="http://finance.example.com")
    ok = make_settings(app_env="production", frontend_origin="https://finance.example.com")
    assert ok.cookie_secure is True


def test_production_password_reset_requires_encrypted_smtp():
    with pytest.raises(ValidationError):
        make_settings(
            app_env="production",
            frontend_origin="https://finance.example.com",
            password_reset_enabled=True,
            email_provider="smtp",
        )
    enabled = make_settings(
        app_env="production",
        frontend_origin="https://finance.example.com",
        password_reset_enabled=True,
        email_provider="smtp",
        smtp_starttls=True,
    )
    assert enabled.password_reset_enabled is True


def test_brevo_requires_smtp_credentials_when_reset_is_enabled():
    with pytest.raises(ValidationError):
        make_settings(password_reset_enabled=True, email_provider="brevo")
    enabled = make_settings(
        password_reset_enabled=True,
        email_provider="brevo",
        smtp_username="brevo-login",
        smtp_password="brevo-smtp-key",
        smtp_from_email="verified@example.com",
    )
    assert enabled.email_provider == "brevo"


def test_development_cookie_is_not_secure():
    assert make_settings(app_env="development").cookie_secure is False


def test_frontend_origin_trailing_slash_is_stripped():
    assert make_settings(frontend_origin="http://localhost:5173/").frontend_origin == (
        "http://localhost:5173"
    )


def test_defaults():
    s = make_settings()
    assert s.session_cookie_name == "finance_session"
    assert s.session_absolute_days == 7
    assert s.session_idle_hours == 24
    assert s.login_max_failures_per_ip == 5
    assert s.login_max_failures_per_account == 20
    assert s.login_window_minutes == 15
    assert s.password_reset_enabled is False
    assert s.password_reset_expiry_minutes == 30
    assert s.password_reset_max_requests == 3
    assert s.password_reset_window_minutes == 15
    assert s.email_provider == "disabled"
    assert s.smtp_host == "localhost"
    assert s.smtp_port == 25
    assert s.smtp_starttls is False
    assert s.trusted_proxy is False


def test_database_url_is_normalized_for_psycopg():
    s = make_settings(database_url="postgresql://u:p@localhost/db")
    assert s.sqlalchemy_database_url == "postgresql+psycopg://u:p@localhost/db"
    s = make_settings(database_url="postgres://u:p@localhost/db")
    assert s.sqlalchemy_database_url == "postgresql+psycopg://u:p@localhost/db"
