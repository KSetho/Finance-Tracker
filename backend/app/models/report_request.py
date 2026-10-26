import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Index, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UTCDateTime, UUIDPrimaryKeyMixin


class ReportRequest(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "report_requests"
    __table_args__ = (
        Index("ix_report_requests_user_created", "user_id", "created_at"),
        Index("ix_report_requests_source_created", "source_ip", "created_at"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    source_ip: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), server_default=func.now(), nullable=False
    )
