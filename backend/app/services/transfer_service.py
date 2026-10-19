"""Transfers between the owner's accounts, and the one rule that makes fees safe.

A fee is a separate expense row linked to its parent (a transfer, or an expense paid to another
person). `sync_fee` is the only code that creates, changes or removes it, so a parent and its fee
always change together, in the caller's single database transaction, and the parent's `fee_amount`
is only ever an input - never a figure that gets summed.
"""

import logging
import uuid
from decimal import Decimal

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.exceptions import BusinessRuleError, IdConflict, NotFound
from app.models import Transaction, TransactionType
from app.repositories import category_repository, transaction_repository
from app.schemas.transaction import TransactionOut, TransferCreate, TransferUpdate
from app.services.transaction_support import (
    _out,
    _same_as_request,
    check_version,
    fee_account_matches,
    validate_accounts,
)

ZERO = Decimal("0.00")
FEE_PREFIX = "Fee: "

logger = logging.getLogger("app.finance")


def fee_id_for(parent_id: uuid.UUID) -> uuid.UUID:
    """Deterministic id of a parent's fee row, so a retry can never produce a second one."""
    return uuid.uuid5(parent_id, "fee")


def _fee_name(parent_name: str) -> str:
    return f"{FEE_PREFIX}{parent_name}"[:120]


def sync_fee(
    db: Session,
    clock: Clock,
    user_id: uuid.UUID,
    parent: Transaction,
    *,
    fee_amount: Decimal,
    fee_account_id: uuid.UUID | None,
) -> None:
    """Make the parent's linked fee match `fee_amount`: create, update or delete the single row.

    The fee takes the parent's date and name, is charged to `fee_account_id` (else the account it
    already used, else the parent's account) and sits in the Fees category. The caller commits.
    """
    existing = transaction_repository.fees_for_parents(db, [parent.id]).get(parent.id)

    if fee_amount <= 0:
        if existing is not None:
            transaction_repository.delete(db, existing)
        parent.fee_amount = ZERO
        return

    account_id = fee_account_id or (existing.account_id if existing else parent.account_id)
    unchanged = existing is not None and existing.account_id == account_id
    validate_accounts(
        db, user_id, {account_id}, parent.transaction_date, set() if unchanged else {account_id}
    )

    now = clock.now()
    if existing is None:
        fees_category = category_repository.get_fees_category(db, user_id)
        if fees_category is None:  # cannot happen for a provisioned owner
            raise BusinessRuleError("validation_error", "The Fees category is missing.")
        transaction_repository.add(
            db,
            Transaction(
                id=fee_id_for(parent.id),
                user_id=user_id,
                type=TransactionType.expense,
                name=_fee_name(parent.name),
                amount=fee_amount,
                transaction_date=parent.transaction_date,
                account_id=account_id,
                category_id=fees_category.id,
                related_transaction_id=parent.id,
                created_at=now,
                updated_at=now,
            ),
        )
    else:
        existing.name = _fee_name(parent.name)
        existing.amount = fee_amount
        existing.account_id = account_id
        existing.transaction_date = parent.transaction_date
        existing.updated_at = now
        existing.version += 1
        db.flush()
    parent.fee_amount = fee_amount


def _require_transfer(row: Transaction | None) -> Transaction:
    if row is None or row.type != TransactionType.transfer or row.related_transaction_id:
        raise NotFound()
    return row


def _check_transfer_fee_account(
    source: uuid.UUID, destination: uuid.UUID, fee_account: uuid.UUID
) -> None:
    if fee_account not in {source, destination}:
        raise BusinessRuleError(
            "validation_error", "The fee must be charged to the source or the destination account."
        )


def _check_distinct(source: uuid.UUID, destination: uuid.UUID) -> None:
    if source == destination:
        raise BusinessRuleError("same_account", "Choose two different accounts.")


def create_transfer(
    db: Session, clock: Clock, user_id: uuid.UUID, data: TransferCreate
) -> tuple[TransactionOut, bool]:
    fields = {
        "type": TransactionType.transfer,
        "name": data.name,
        "description": data.description,
        "amount": data.amount,
        "transaction_date": data.transaction_date,
        "account_id": data.source_account_id,
        "destination_account_id": data.destination_account_id,
        "fee_amount": data.fee_amount,
    }
    if data.id is not None:
        existing = transaction_repository.get_owned(db, user_id, data.id)
        if existing is not None:
            if _same_as_request(existing, fields) and fee_account_matches(
                db, existing, data.fee_account_id
            ):
                return _out(db, user_id, existing), False
            raise IdConflict()

    _check_distinct(data.source_account_id, data.destination_account_id)
    both = {data.source_account_id, data.destination_account_id}
    validate_accounts(db, user_id, both, data.transaction_date, both)
    fee_account = data.fee_account_id or data.source_account_id
    if data.fee_amount > 0:
        _check_transfer_fee_account(
            data.source_account_id, data.destination_account_id, fee_account
        )

    now = clock.now()
    row = Transaction(
        id=data.id or uuid.uuid4(), user_id=user_id, created_at=now, updated_at=now, **fields
    )
    try:
        transaction_repository.add(db, row)
        sync_fee(db, clock, user_id, row, fee_amount=data.fee_amount, fee_account_id=fee_account)
        db.commit()
        logger.info("transfer_created id=%s", row.id)
    except IntegrityError as exc:  # a parallel request with the same id won the race
        db.rollback()
        raced = transaction_repository.get_owned(db, user_id, data.id) if data.id else None
        if raced is not None and _same_as_request(raced, fields):
            return _out(db, user_id, raced), False
        raise IdConflict() from exc
    return _out(db, user_id, row), True


def get_transfer(db: Session, user_id: uuid.UUID, transfer_id: uuid.UUID) -> TransactionOut:
    row = _require_transfer(transaction_repository.get_owned(db, user_id, transfer_id))
    return _out(db, user_id, row)


def update_transfer(
    db: Session, clock: Clock, user_id: uuid.UUID, transfer_id: uuid.UUID, data: TransferUpdate
) -> TransactionOut:
    row = _require_transfer(
        transaction_repository.get_owned(db, user_id, transfer_id, for_update=True)
    )
    check_version(row, data.version)
    changes = data.model_dump(exclude_unset=True, exclude={"version"})

    source = changes.get("source_account_id", row.account_id)
    destination = changes.get("destination_account_id", row.destination_account_id)
    on_date = changes.get("transaction_date", row.transaction_date)
    _check_distinct(source, destination)

    changed = {
        a for a in (source, destination) if a not in {row.account_id, row.destination_account_id}
    }
    validate_accounts(db, user_id, {source, destination}, on_date, changed)

    existing_fee = transaction_repository.fees_for_parents(db, [row.id]).get(row.id)
    fee_amount = changes.get("fee_amount", row.fee_amount)
    fee_account = (
        changes.get("fee_account_id")
        or (existing_fee.account_id if existing_fee else None)
        or source
    )
    if fee_amount > 0:
        _check_transfer_fee_account(source, destination, fee_account)

    for field in ("name", "description", "amount", "transaction_date"):
        if field in changes:
            setattr(row, field, changes[field])
    row.account_id = source
    row.destination_account_id = destination
    sync_fee(db, clock, user_id, row, fee_amount=fee_amount, fee_account_id=fee_account)
    row.version += 1
    row.updated_at = clock.now()
    db.commit()
    logger.info("transfer_updated id=%s", row.id)
    return _out(db, user_id, row)


def delete_transfer(db: Session, user_id: uuid.UUID, transfer_id: uuid.UUID) -> None:
    row = _require_transfer(
        transaction_repository.get_owned(db, user_id, transfer_id, for_update=True)
    )
    transaction_repository.delete(db, row)  # its fee goes with it (ON DELETE CASCADE)
    db.commit()
    logger.info("transfer_deleted id=%s", transfer_id)
