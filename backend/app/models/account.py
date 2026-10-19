import enum
import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Numeric,
    String,
    Uuid,
    text,
)
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class AccountType(enum.StrEnum):
    bank = "bank"
    mobile_money = "mobile_money"
    cash = "cash"


class Account(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "accounts"
    __table_args__ = (
        # Target of the composite foreign keys that keep transactions inside one owner.
        Index("uq_accounts_id_user", "id", "user_id", unique=True),
        CheckConstraint("opening_balance >= 0", name="ck_accounts_opening_balance_nonneg"),
        Index("uq_accounts_user_lower_name", "user_id", text("lower(name)"), unique=True),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    account_type: Mapped[AccountType] = mapped_column(
        SAEnum(AccountType, name="account_type", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
    )
    opening_balance: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00"), server_default="0"
    )
    opening_date: Mapped[date] = mapped_column(Date, nullable=False)
    is_archived: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
