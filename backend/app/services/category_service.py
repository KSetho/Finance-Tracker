import uuid

from sqlalchemy.orm import Session

from app.core.exceptions import BusinessRuleError, NotFound
from app.models import Category, CategoryType
from app.repositories import category_repository

DEFAULT_CATEGORIES: list[tuple[str, CategoryType]] = [
    ("Salary", CategoryType.income),
    ("Freelance", CategoryType.income),
    ("Business", CategoryType.income),
    ("Gift", CategoryType.income),
    ("Other income", CategoryType.income),
    ("Food", CategoryType.expense),
    ("Transport", CategoryType.expense),
    ("Bills", CategoryType.expense),
    ("Shopping", CategoryType.expense),
    ("Health", CategoryType.expense),
    ("Family", CategoryType.expense),
    ("Fees", CategoryType.expense),
    ("Other expense", CategoryType.expense),
]


def seed_defaults(db: Session, user_id: uuid.UUID) -> None:
    """Create the built-in categories for an owner. Safe to call repeatedly; caller commits."""
    category_repository.insert_missing(db, user_id, DEFAULT_CATEGORIES)


def list_categories(db: Session, user_id: uuid.UUID, category_type: CategoryType | None):
    return category_repository.list_for_user(db, user_id, category_type)


def require_category(
    db: Session, user_id: uuid.UUID, category_id: uuid.UUID, expected: CategoryType
) -> Category:
    """The owner's category of the expected type, or NotFound / a business-rule error."""
    category = category_repository.get_owned(db, user_id, category_id)
    if category is None:
        raise NotFound()
    if category.category_type != expected:
        raise BusinessRuleError(
            "category_type_mismatch",
            f"Choose an {expected.value} category.",
        )
    return category
