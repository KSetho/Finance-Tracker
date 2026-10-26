import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Index, Integer, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UTCDateTime, UUIDPrimaryKeyMixin


class DataWipeToken(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "data_wipe_tokens"
    __table_args__ = (
        Index("ix_data_wipe_tokens_user_created", "user_id", "created_at"),
        Index("ix_data_wipe_tokens_source_created", "source_ip", "created_at"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    source_ip: Mapped[str] = mapped_column(String(64), nullable=False)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
