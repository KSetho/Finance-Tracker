from datetime import date

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
    with pytest.raises(RuntimeError, match="disabled"):
        sender.send_data_wipe_code("owner@example.com", "123456", 10)
    with pytest.raises(RuntimeError, match="disabled"):
        sender.send_transaction_csv_report(
            "owner@example.com",
            start_date=date(2026, 1, 1),
            end_date=date(2026, 1, 31),
            csv_bytes=b"date\n",
            filename="transactions_2026-01-01_to_2026-01-31.csv",
        )


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


def test_data_wipe_email_includes_code(monkeypatch):
    FakeSmtp.instances.clear()
    monkeypatch.setattr("app.core.email.smtplib.SMTP", FakeSmtp)
    sender = make_password_reset_sender(
        settings(email_provider="smtp", smtp_from_email="verified@example.com")
    )
    sender.send_data_wipe_code("owner@example.com", "654321", 10)
    smtp = FakeSmtp.instances[0]
    body = smtp.message.get_content()
    assert "654321" in body
    assert "Confirm Finance Tracker data wipe" == smtp.message["Subject"]


def test_transaction_csv_report_attaches_file(monkeypatch):
    FakeSmtp.instances.clear()
    monkeypatch.setattr("app.core.email.smtplib.SMTP", FakeSmtp)
    sender = make_password_reset_sender(
        settings(email_provider="smtp", smtp_from_email="verified@example.com")
    )
    csv_bytes = b"\xef\xbb\xbfdate,type\n2026-10-01,expense\n"
    sender.send_transaction_csv_report(
        "owner@example.com",
        start_date=date(2026, 10, 1),
        end_date=date(2026, 10, 31),
        csv_bytes=csv_bytes,
        filename="transactions_2026-10-01_to_2026-10-31.csv",
    )
    smtp = FakeSmtp.instances[0]
    assert "2026-10-01 to 2026-10-31" in smtp.message["Subject"]
    attachments = list(smtp.message.iter_attachments())
    assert len(attachments) == 1
    assert attachments[0].get_filename() == "transactions_2026-10-01_to_2026-10-31.csv"
    assert attachments[0].get_payload(decode=True) == csv_bytes
    assert smtp.message["To"] == "owner@example.com"
