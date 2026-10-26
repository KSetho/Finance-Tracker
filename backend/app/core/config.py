from functools import lru_cache
from typing import Literal

from email_validator import EmailNotValidError, validate_email
from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def normalize_email(value: str) -> str:
    """Single email normalization used by config, login and provisioning."""
    return value.strip().lower()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    owner_email: str
    database_url: str
    secret_key: str
    session_cookie_name: str = "finance_session"
    app_env: Literal["development", "test", "production"] = "development"
    frontend_origin: str = "http://localhost:5173"

    session_absolute_days: int = Field(default=7, gt=0)
    session_idle_hours: int = Field(default=24, gt=0)
    login_max_failures_per_ip: int = Field(default=5, gt=0)
    login_max_failures_per_account: int = Field(default=20, gt=0)
    login_window_minutes: int = Field(default=15, gt=0)
    password_reset_enabled: bool = False
    password_reset_expiry_minutes: int = Field(default=30, gt=0)
    password_reset_max_requests: int = Field(default=3, gt=0)
    password_reset_window_minutes: int = Field(default=15, gt=0)
    data_wipe_expiry_minutes: int = Field(default=10, gt=0)
    data_wipe_max_requests: int = Field(default=3, gt=0)
    data_wipe_window_minutes: int = Field(default=15, gt=0)
    data_wipe_max_attempts: int = Field(default=5, gt=0)
    report_max_requests: int = Field(default=5, gt=0)
    report_window_minutes: int = Field(default=15, gt=0)
    email_provider: Literal["disabled", "smtp", "brevo"] = "disabled"
    smtp_host: str = "localhost"
    smtp_port: int = Field(default=25, ge=1, le=65535)
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str = "no-reply@localhost"
    smtp_starttls: bool = False
    smtp_timeout_seconds: float = Field(default=10.0, gt=0)
    trusted_proxy: bool = False

    @field_validator("owner_email")
    @classmethod
    def _validate_owner_email(cls, value: str) -> str:
        normalized = normalize_email(value)
        try:
            validate_email(normalized, check_deliverability=False)
        except EmailNotValidError as exc:
            raise ValueError(f"OWNER_EMAIL is not a valid email address: {exc}") from exc
        return normalized

    @field_validator("secret_key")
    @classmethod
    def _validate_secret_key(cls, value: str) -> str:
        if len(value.encode()) < 32:
            raise ValueError("SECRET_KEY must be at least 32 bytes long")
        return value

    @field_validator("frontend_origin")
    @classmethod
    def _strip_origin_slash(cls, value: str) -> str:
        return value.strip().rstrip("/")

    @model_validator(mode="after")
    def _production_requires_https(self) -> "Settings":
        if self.app_env == "production" and not self.frontend_origin.startswith("https://"):
            raise ValueError("FRONTEND_ORIGIN must use https:// when APP_ENV=production")
        if self.password_reset_enabled and self.email_provider == "disabled":
            raise ValueError("EMAIL_PROVIDER must be smtp or brevo when password reset is enabled")
        if (
            self.app_env == "production"
            and self.password_reset_enabled
            and self.email_provider == "smtp"
            and not self.smtp_starttls
        ):
            raise ValueError(
                "SMTP_STARTTLS must be true when password reset is enabled in production"
            )
        if self.password_reset_enabled and self.email_provider == "brevo":
            if not self.smtp_username or not self.smtp_password:
                raise ValueError(
                    "SMTP_USERNAME and SMTP_PASSWORD are required for the Brevo provider"
                )
            if not self.smtp_from_email.strip():
                raise ValueError("SMTP_FROM_EMAIL is required for the Brevo provider")
        return self

    @property
    def cookie_secure(self) -> bool:
        return self.app_env == "production"

    @property
    def sqlalchemy_database_url(self) -> str:
        """Accept provider-style URLs and select the psycopg 3 driver."""
        url = self.database_url
        for prefix in ("postgresql://", "postgres://"):
            if url.startswith(prefix):
                return "postgresql+psycopg://" + url[len(prefix) :]
        return url


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # values come from the environment
