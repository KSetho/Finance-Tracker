import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.dialect import dialect_insert
from app.models import Category, CategoryType


def list_for_user(db: Session, user_id: uuid.UUID, category_type: CategoryType | None = None):
    query = select(Category).where(Category.user_id == user_id)
    if category_type is not None:
        query = query.where(Category.category_type == category_type)
    return db.scalars(query.order_by(Category.category_type, Category.name)).all()


def get_owned(db: Session, user_id: uuid.UUID, category_id: uuid.UUID) -> Category | None:
    return db.scalar(
        select(Category).where(Category.id == category_id, Category.user_id == user_id)
    )


def get_fees_category(db: Session, user_id: uuid.UUID) -> Category | None:
    return db.scalar(
        select(Category).where(
            Category.user_id == user_id,
            Category.category_type == CategoryType.expense,
            Category.name == "Fees",
        )
    )


def insert_missing(db: Session, user_id: uuid.UUID, rows: list[tuple[str, CategoryType]]) -> None:
    """Idempotent: existing (user, type, name) rows are left alone."""
    for name, category_type in rows:
        db.execute(
            dialect_insert(db, Category)
            .values(
                id=uuid.uuid4(),
                user_id=user_id,
                name=name,
                category_type=category_type,
                is_system=True,
            )
            .on_conflict_do_nothing(index_elements=["user_id", "category_type", "name"])
        )
    db.flush()


def get_many(
    db: Session, user_id: uuid.UUID, category_ids: set[uuid.UUID]
) -> dict[uuid.UUID, Category]:
    if not category_ids:
        return {}
    rows = db.scalars(
        select(Category).where(Category.user_id == user_id, Category.id.in_(category_ids))
    )
    return {row.id: row for row in rows}
