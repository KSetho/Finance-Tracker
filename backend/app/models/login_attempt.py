from datetime import datetime

from sqlalchemy import Index, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UTCDateTime, UUIDPrimaryKeyMixin


class LoginAttempt(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "login_attempts"
    __table_args__ = (
        Index("ix_login_attempts_ip_time", "source_ip", "attempted_at"),
        Index("ix_login_attempts_email_time", "email", "attempted_at"),
    )

    source_ip: Mapped[str] = mapped_column(Text, nullable=False)
    email: Mapped[str] = mapped_column(Text, nullable=False)
    attempted_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
