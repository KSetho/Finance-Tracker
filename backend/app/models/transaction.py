import enum
import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Date,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    Uuid,
    text,
)
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class TransactionType(enum.StrEnum):
    income = "income"
    expense = "expense"
    transfer = "transfer"


class Transaction(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Income, expense or transfer. A fee is an expense row whose related_transaction_id is its
    parent; the parent's fee_amount is the input value and is never summed."""

    __tablename__ = "transactions"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_transactions_amount_positive"),
        CheckConstraint("fee_amount >= 0", name="ck_transactions_fee_nonneg"),
        CheckConstraint(
            "(type IN ('income', 'expense') AND account_id IS NOT NULL"
            " AND destination_account_id IS NULL)"
            " OR (type = 'transfer' AND account_id IS NOT NULL"
            " AND destination_account_id IS NOT NULL AND account_id <> destination_account_id)",
            name="ck_transactions_shape",
        ),
        CheckConstraint(
            "related_transaction_id IS NULL OR (type = 'expense' AND fee_amount = 0)",
            name="ck_transactions_fee_row",
        ),
        ForeignKeyConstraint(
            ["account_id", "user_id"],
            ["accounts.id", "accounts.user_id"],
            name="fk_tx_account_owner",
        ),
        ForeignKeyConstraint(
            ["destination_account_id", "user_id"],
            ["accounts.id", "accounts.user_id"],
            name="fk_tx_destination_owner",
        ),
        ForeignKeyConstraint(
            ["category_id", "user_id"],
            ["categories.id", "categories.user_id"],
            name="fk_tx_category_owner",
        ),
        Index(
            "uq_transactions_related",
            "related_transaction_id",
            unique=True,
            postgresql_where=text("related_transaction_id IS NOT NULL"),
        ),
        Index(
            "ix_transactions_user_date",
            "user_id",
            text("transaction_date DESC"),
            text("created_at DESC"),
        ),
        Index("ix_transactions_user_type_date", "user_id", "type", "transaction_date"),
        Index("ix_transactions_account", "account_id"),
        Index("ix_transactions_destination", "destination_account_id"),
        Index("ix_transactions_category", "category_id"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    type: Mapped[TransactionType] = mapped_column(
        SAEnum(
            TransactionType, name="transaction_type", values_callable=lambda e: [m.value for m in e]
        ),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    transaction_date: Mapped[date] = mapped_column(Date, nullable=False)
    account_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    destination_account_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    category_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    fee_amount: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), nullable=False, default=Decimal("0.00"), server_default="0"
    )
    related_transaction_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("transactions.id", ondelete="CASCADE"), nullable=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
