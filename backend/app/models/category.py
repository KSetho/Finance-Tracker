import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Index, String, Uuid, func
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UTCDateTime, UUIDPrimaryKeyMixin


class CategoryType(enum.StrEnum):
    income = "income"
    expense = "expense"


class Category(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "categories"
    __table_args__ = (
        Index("uq_categories_id_user", "id", "user_id", unique=True),
        Index("uq_categories_user_type_name", "user_id", "category_type", "name", unique=True),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    category_type: Mapped[CategoryType] = mapped_column(
        SAEnum(CategoryType, name="category_type", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
    )
    is_system: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), server_default=func.now(), nullable=False
    )
