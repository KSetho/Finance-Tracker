import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, ForeignKey, Index, Numeric, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class MonthlyBudget(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "monthly_budgets"
    __table_args__ = (
        CheckConstraint("allowance >= 0", name="ck_budgets_allowance_nonneg"),
        CheckConstraint("EXTRACT(day FROM month_start) = 1", name="ck_budgets_month_start"),
        Index("uq_budgets_user_month", "user_id", "month_start", unique=True),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    month_start: Mapped[date] = mapped_column(Date, nullable=False)
    allowance: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
