import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import Transaction, TransactionType


@dataclass(frozen=True)
class TransactionFilters:
    start_date: date | None = None
    end_date: date | None = None
    type: TransactionType | None = None
    category_id: uuid.UUID | None = None
    account_id: uuid.UUID | None = None  # matches the source or the destination account
    q: str | None = None  # case-insensitive name search, matched literally


def get_owned(
    db: Session, user_id: uuid.UUID, transaction_id: uuid.UUID, for_update: bool = False
) -> Transaction | None:
    query = select(Transaction).where(
        Transaction.id == transaction_id, Transaction.user_id == user_id
    )
    if for_update:
        query = query.with_for_update()
    return db.scalar(query)


def add(db: Session, transaction: Transaction) -> Transaction:
    db.add(transaction)
    db.flush()
    return transaction


def delete(db: Session, transaction: Transaction) -> None:
    db.delete(transaction)
    db.flush()


def fees_for_parents(db: Session, parent_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, Transaction]:
    """The linked fee expense of each parent that has one, keyed by parent id."""
    ids = list(parent_ids)
    if not ids:
        return {}
    rows: Sequence[Transaction] = db.scalars(
        select(Transaction).where(Transaction.related_transaction_id.in_(ids))
    ).all()
    return {row.related_transaction_id: row for row in rows if row.related_transaction_id}


def _conditions(user_id: uuid.UUID, filters: TransactionFilters) -> list:
    conditions = [Transaction.user_id == user_id]
    if filters.start_date is not None:
        conditions.append(Transaction.transaction_date >= filters.start_date)
    if filters.end_date is not None:
        conditions.append(Transaction.transaction_date <= filters.end_date)
    if filters.type is not None:
        conditions.append(Transaction.type == filters.type)
    if filters.category_id is not None:
        conditions.append(Transaction.category_id == filters.category_id)
    if filters.account_id is not None:
        conditions.append(
            or_(
                Transaction.account_id == filters.account_id,
                Transaction.destination_account_id == filters.account_id,
            )
        )
    if filters.q:
        escaped = filters.q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        conditions.append(Transaction.name.ilike(f"%{escaped}%", escape="\\"))
    return conditions


def list_page(
    db: Session,
    user_id: uuid.UUID,
    filters: TransactionFilters,
    sort_by: str,
    sort_order: str,
    page: int,
    page_size: int,
) -> Sequence[Transaction]:
    descending = sort_order == "desc"
    primary = Transaction.amount if sort_by == "amount" else Transaction.transaction_date
    direction = (lambda column: column.desc()) if descending else (lambda column: column.asc())
    if sort_by == "amount":
        order = [
            direction(primary),
            Transaction.transaction_date.desc(),
            Transaction.created_at.desc(),
        ]
    else:
        order = [direction(primary), direction(Transaction.created_at), direction(Transaction.id)]
    query = (
        select(Transaction)
        .where(*_conditions(user_id, filters))
        .order_by(*order)
        .limit(page_size)
        .offset((page - 1) * page_size)
    )
    return db.scalars(query).all()


def list_all(
    db: Session,
    user_id: uuid.UUID,
    filters: TransactionFilters,
) -> Sequence[Transaction]:
    """Every matching row, oldest date first (for exports)."""
    query = (
        select(Transaction)
        .where(*_conditions(user_id, filters))
        .order_by(
            Transaction.transaction_date.asc(),
            Transaction.created_at.asc(),
            Transaction.id.asc(),
        )
    )
    return db.scalars(query).all()



def count(db: Session, user_id: uuid.UUID, filters: TransactionFilters) -> int:
    return (
        db.scalar(
            select(func.count()).select_from(Transaction).where(*_conditions(user_id, filters))
        )
        or 0
    )
