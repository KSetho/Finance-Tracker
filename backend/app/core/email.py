import smtplib
from email.message import EmailMessage
from typing import Protocol

from app.core.config import Settings


class PasswordResetSender(Protocol):
    def send_password_reset(self, recipient: str, reset_url: str, expiry_minutes: int) -> None: ...


class DisabledPasswordResetSender:
    def send_password_reset(self, recipient: str, reset_url: str, expiry_minutes: int) -> None:
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

    def send_password_reset(self, recipient: str, reset_url: str, expiry_minutes: int) -> None:
        message = EmailMessage()
        message["Subject"] = "Reset your Finance Tracker password"
        message["From"] = self.settings.smtp_from_email
        message["To"] = recipient
        message.set_content(
            "Use this link to reset your Finance Tracker password:\n\n"
            f"{reset_url}\n\n"
            f"This link expires in {expiry_minutes} minutes. If you did not request it, ignore "
            "this email."
        )

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


def make_password_reset_sender(settings: Settings) -> PasswordResetSender:
    if settings.email_provider == "disabled":
        return DisabledPasswordResetSender()
    return SmtpPasswordResetSender(settings)
