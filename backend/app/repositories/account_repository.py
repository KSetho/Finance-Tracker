import uuid
from collections.abc import Sequence
from datetime import date

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import Account, Transaction


def list_for_user(db: Session, user_id: uuid.UUID, include_archived: bool) -> Sequence[Account]:
    query = select(Account).where(Account.user_id == user_id)
    if not include_archived:
        query = query.where(Account.is_archived.is_(False))
    return db.scalars(query.order_by(Account.created_at, Account.name)).all()


def get_owned(
    db: Session, user_id: uuid.UUID, account_id: uuid.UUID, for_update: bool = False
) -> Account | None:
    query = select(Account).where(Account.id == account_id, Account.user_id == user_id)
    if for_update:
        query = query.with_for_update()
    return db.scalar(query)


def get_many_owned(
    db: Session, user_id: uuid.UUID, account_ids: set[uuid.UUID], for_update: bool = False
) -> dict[uuid.UUID, Account]:
    """The owner's accounts by id, locked in id order so concurrent writers cannot deadlock."""
    if not account_ids:
        return {}
    query = (
        select(Account)
        .where(Account.user_id == user_id, Account.id.in_(account_ids))
        .order_by(Account.id)
    )
    if for_update:
        query = query.with_for_update()
    return {account.id: account for account in db.scalars(query)}


def add(db: Session, account: Account) -> Account:
    db.add(account)
    db.flush()
    return account


def name_exists(
    db: Session, user_id: uuid.UUID, name: str, exclude_id: uuid.UUID | None = None
) -> bool:
    query = select(Account.id).where(
        Account.user_id == user_id, func.lower(Account.name) == name.lower()
    )
    if exclude_id is not None:
        query = query.where(Account.id != exclude_id)
    return db.scalar(query.limit(1)) is not None


def earliest_activity_date(db: Session, account_id: uuid.UUID) -> date | None:
    return db.scalar(
        select(func.min(Transaction.transaction_date)).where(
            or_(
                Transaction.account_id == account_id,
                Transaction.destination_account_id == account_id,
            )
        )
    )
