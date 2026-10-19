"""Helpers shared by the transaction and transfer services (apart, to avoid a circular import)."""

import uuid
from datetime import date

from sqlalchemy.orm import Session

from app.core.exceptions import BusinessRuleError, NotFound, StaleVersion
from app.models import Account, Transaction
from app.repositories import account_repository, category_repository, transaction_repository
from app.schemas.category import CategoryOut
from app.schemas.transaction import AccountRef, FeeRef, TransactionOut


def build_outs(db: Session, user_id: uuid.UUID, rows: list[Transaction]) -> list[TransactionOut]:
    """Build API objects from transactions with three batched lookups."""
    fees = transaction_repository.fees_for_parents(
        db, [row.id for row in rows if row.related_transaction_id is None]
    )
    account_ids = {row.account_id for row in rows} | {fee.account_id for fee in fees.values()}
    account_ids |= {row.destination_account_id for row in rows if row.destination_account_id}
    accounts = account_repository.get_many_owned(db, user_id, account_ids)
    categories = category_repository.get_many(
        db, user_id, {row.category_id for row in rows if row.category_id}
    )

    def ref(account_id: uuid.UUID) -> AccountRef:
        return AccountRef(id=account_id, name=accounts[account_id].name)

    outs = []
    for row in rows:
        fee = fees.get(row.id)
        category = categories.get(row.category_id) if row.category_id else None
        outs.append(
            TransactionOut(
                id=row.id,
                type=row.type,
                name=row.name,
                description=row.description,
                amount=row.amount,
                transaction_date=row.transaction_date,
                account=ref(row.account_id),
                destination_account=(
                    ref(row.destination_account_id) if row.destination_account_id else None
                ),
                category=(
                    CategoryOut(
                        id=category.id,
                        name=category.name,
                        category_type=category.category_type,
                        is_system=category.is_system,
                    )
                    if category
                    else None
                ),
                fee_amount=row.fee_amount,
                fee=(
                    FeeRef(id=fee.id, amount=fee.amount, account=ref(fee.account_id))
                    if fee
                    else None
                ),
                is_fee=row.related_transaction_id is not None,
                related_transaction_id=row.related_transaction_id,
                version=row.version,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )
        )
    return outs


def _out(db: Session, user_id: uuid.UUID, row: Transaction) -> TransactionOut:
    return build_outs(db, user_id, [row])[0]


def validate_accounts(
    db: Session,
    user_id: uuid.UUID,
    account_ids: set[uuid.UUID],
    on_date: date,
    changed: set[uuid.UUID],
) -> dict[uuid.UUID, Account]:
    """Every account must be the owner's, not archived (unless the reference is unchanged) and open
    on the transaction date. The accounts are locked so they cannot change underneath the write."""
    accounts = account_repository.get_many_owned(db, user_id, account_ids, for_update=True)
    for account_id in account_ids:
        account = accounts.get(account_id)
        if account is None:
            raise NotFound()
        if account.is_archived and account_id in changed:
            raise BusinessRuleError(
                "account_archived", f"{account.name} is archived. Choose another account."
            )
        if on_date < account.opening_date:
            raise BusinessRuleError(
                "before_opening_date",
                f"{account.name} was opened on {account.opening_date.isoformat()}. "
                "Choose a later date.",
            )
    return accounts


def check_version(row: Transaction, version: int) -> None:
    if row.version != version:
        raise StaleVersion()


def _same_as_request(existing: Transaction, expected: dict) -> bool:
    return all(getattr(existing, field) == value for field, value in expected.items())


def fee_account_matches(
    db: Session, existing: Transaction, fee_account_id: uuid.UUID | None
) -> bool:
    """Whether an existing parent's fee is charged to the requested account (None = any)."""
    if fee_account_id is None or existing.fee_amount <= 0:
        return True
    fee = transaction_repository.fees_for_parents(db, [existing.id]).get(existing.id)
    return fee is not None and fee.account_id == fee_account_id
