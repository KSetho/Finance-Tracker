import smtplib
from datetime import date
from email.message import EmailMessage
from typing import Protocol

from app.core.config import Settings


class PasswordResetSender(Protocol):
    def send_password_reset(self, recipient: str, reset_url: str, expiry_minutes: int) -> None: ...

    def send_data_wipe_code(self, recipient: str, code: str, expiry_minutes: int) -> None: ...

    def send_transaction_csv_report(
        self,
        recipient: str,
        *,
        start_date: date,
        end_date: date,
        csv_bytes: bytes,
        filename: str,
    ) -> None: ...


class DisabledPasswordResetSender:
    def send_password_reset(self, recipient: str, reset_url: str, expiry_minutes: int) -> None:
        raise RuntimeError("Email delivery is disabled")

    def send_data_wipe_code(self, recipient: str, code: str, expiry_minutes: int) -> None:
        raise RuntimeError("Email delivery is disabled")

    def send_transaction_csv_report(
        self,
        recipient: str,
        *,
        start_date: date,
        end_date: date,
        csv_bytes: bytes,
        filename: str,
    ) -> None:
        raise RuntimeError("Email delivery is disabled")


class SmtpPasswordResetSender:
    """Small, injectable stdlib SMTP adapter."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.host = (
            "smtp-relay.brevo.com" if settings.email_provider == "brevo" else settings.smtp_host
        )
        self.port = 587 if settings.email_provider == "brevo" else settings.smtp_port
        self.starttls = settings.email_provider == "brevo" or settings.smtp_starttls

    def _deliver(self, message: EmailMessage) -> None:
        with smtplib.SMTP(
            self.host,
            self.port,
            timeout=self.settings.smtp_timeout_seconds,
        ) as smtp:
            if self.starttls:
                smtp.starttls()
            if self.settings.smtp_username:
                smtp.login(self.settings.smtp_username, self.settings.smtp_password or "")
            smtp.send_message(message)

    def _send(self, *, recipient: str, subject: str, body: str) -> None:
        message = EmailMessage()
        message["Subject"] = subject
        message["From"] = self.settings.smtp_from_email
        message["To"] = recipient
        message.set_content(body)
        self._deliver(message)

    def send_password_reset(self, recipient: str, reset_url: str, expiry_minutes: int) -> None:
        self._send(
            recipient=recipient,
            subject="Reset your Finance Tracker password",
            body=(
                "Use this link to reset your Finance Tracker password:\n\n"
                f"{reset_url}\n\n"
                f"This link expires in {expiry_minutes} minutes. If you did not request it, ignore "
                "this email."
            ),
        )

    def send_data_wipe_code(self, recipient: str, code: str, expiry_minutes: int) -> None:
        self._send(
            recipient=recipient,
            subject="Confirm Finance Tracker data wipe",
            body=(
                "Use this verification code to wipe finance data in Finance Tracker:\n\n"
                f"{code}\n\n"
                f"This code expires in {expiry_minutes} minutes. If you did not request a data "
                "wipe, ignore this email — your data will not be changed."
            ),
        )

    def send_transaction_csv_report(
        self,
        recipient: str,
        *,
        start_date: date,
        end_date: date,
        csv_bytes: bytes,
        filename: str,
    ) -> None:
        message = EmailMessage()
        message["Subject"] = (
            f"Finance Tracker transactions {start_date.isoformat()} to {end_date.isoformat()}"
        )
        message["From"] = self.settings.smtp_from_email
        message["To"] = recipient
        message.set_content(
            "Your Finance Tracker transaction report is attached.\n\n"
            f"Date range: {start_date.isoformat()} to {end_date.isoformat()} (inclusive).\n\n"
            "If you did not request this report, you can ignore this email."
        )
        message.add_attachment(
            csv_bytes,
            maintype="text",
            subtype="csv",
            filename=filename,
        )
        self._deliver(message)


def make_password_reset_sender(settings: Settings) -> PasswordResetSender:
    if settings.email_provider == "disabled":
        return DisabledPasswordResetSender()
    return SmtpPasswordResetSender(settings)
