import pytest

from app.core.config import Settings
from app.core.email import (
    DisabledPasswordResetSender,
    SmtpPasswordResetSender,
    make_password_reset_sender,
)


def settings(**overrides) -> Settings:
    values = {
        "owner_email": "owner@example.com",
        "database_url": "sqlite://",
        "secret_key": "x" * 48,
        "frontend_origin": "http://localhost:5173",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


class FakeSmtp:
    instances: list["FakeSmtp"] = []

    def __init__(self, host: str, port: int, timeout: float):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.started_tls = False
        self.login_args: tuple[str, str] | None = None
        self.message = None
        self.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def starttls(self):
        self.started_tls = True

    def login(self, username: str, password: str):
        self.login_args = (username, password)

    def send_message(self, message):
        self.message = message


def test_disabled_provider_returns_a_fail_closed_sender():
    sender = make_password_reset_sender(settings())
    assert isinstance(sender, DisabledPasswordResetSender)
    with pytest.raises(RuntimeError, match="disabled"):
        sender.send_password_reset("owner@example.com", "https://example/reset", 30)


def test_brevo_selector_uses_relay_starttls_and_smtp_key(monkeypatch):
    FakeSmtp.instances.clear()
    monkeypatch.setattr("app.core.email.smtplib.SMTP", FakeSmtp)
    configured = settings(
        password_reset_enabled=True,
        email_provider="brevo",
        smtp_username="brevo-login",
        smtp_password="brevo-smtp-key",
        smtp_from_email="verified@example.com",
    )

    sender = make_password_reset_sender(configured)
    assert isinstance(sender, SmtpPasswordResetSender)
    sender.send_password_reset(
        "owner@example.com",
        "https://finance.example/reset-password?token=secret",
        30,
    )

    smtp = FakeSmtp.instances[0]
    assert (smtp.host, smtp.port, smtp.timeout) == ("smtp-relay.brevo.com", 587, 10.0)
    assert smtp.started_tls is True
    assert smtp.login_args == ("brevo-login", "brevo-smtp-key")
    assert smtp.message["From"] == "verified@example.com"
    assert smtp.message["To"] == "owner@example.com"
