import logging
import uuid
from decimal import Decimal

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.exceptions import (
    BusinessRuleError,
    FeeManagedByParent,
    IdConflict,
    NotFound,
    TypeImmutable,
)
from app.models import CategoryType, Transaction, TransactionType
from app.repositories import transaction_repository
from app.repositories.transaction_repository import TransactionFilters
from app.schemas.transaction import (
    ExpenseCreate,
    IncomeCreate,
    TransactionOut,
    TransactionPage,
    TransactionUpdate,
    TransferUpdate,
)
from app.services import category_service, transfer_service
from app.services.transaction_support import (
    _out,
    _same_as_request,
    build_outs,
    check_version,
    fee_account_matches,
    validate_accounts,
)

# ---- create -----------------------------------------------------------------------------

logger = logging.getLogger("app.finance")


def _create(
    db: Session,
    clock: Clock,
    user_id: uuid.UUID,
    kind: TransactionType,
    data: IncomeCreate | ExpenseCreate,
) -> tuple[TransactionOut, bool]:
    fields = {
        "type": kind,
        "name": data.name,
        "description": data.description,
        "amount": data.amount,
        "transaction_date": data.transaction_date,
        "account_id": data.account_id,
        "category_id": data.category_id,
    }
    retry_fields = {**fields, "fee_amount": getattr(data, "fee_amount", Decimal("0.00"))}
    if data.id is not None:
        existing = transaction_repository.get_owned(db, user_id, data.id)
        if existing is not None:
            if _same_as_request(existing, retry_fields) and fee_account_matches(
                db, existing, getattr(data, "fee_account_id", None)
            ):
                return _out(db, user_id, existing), False
            raise IdConflict()

    fee_amount = getattr(data, "fee_amount", Decimal("0.00"))
    fee_account_id = getattr(data, "fee_account_id", None)
    # Lock every account involved at once, in id order: two payments whose fees hit each other's
    # account would otherwise take the locks in opposite orders and deadlock.
    involved = {data.account_id} | (
        {fee_account_id or data.account_id} if fee_amount > 0 else set()
    )
    validate_accounts(db, user_id, involved, data.transaction_date, involved)
    if data.category_id is not None:
        expected = CategoryType.income if kind == TransactionType.income else CategoryType.expense
        category_service.require_category(db, user_id, data.category_id, expected)

    now = clock.now()
    row = Transaction(
        id=data.id or uuid.uuid4(), user_id=user_id, created_at=now, updated_at=now, **fields
    )
    try:
        transaction_repository.add(db, row)
        if fee_amount > 0:
            transfer_service.sync_fee(
                db, clock, user_id, row, fee_amount=fee_amount, fee_account_id=fee_account_id
            )
        db.commit()
        logger.info("transaction_created id=%s type=%s", row.id, kind.value)
    except IntegrityError as exc:  # a parallel request with the same id won the race
        db.rollback()
        raced = transaction_repository.get_owned(db, user_id, data.id) if data.id else None
        if raced is not None and _same_as_request(raced, fields):
            return _out(db, user_id, raced), False
        raise IdConflict() from exc
    return _out(db, user_id, row), True


def create_income(
    db: Session, clock: Clock, user_id: uuid.UUID, data: IncomeCreate
) -> tuple[TransactionOut, bool]:
    return _create(db, clock, user_id, TransactionType.income, data)


def create_expense(
    db: Session, clock: Clock, user_id: uuid.UUID, data: ExpenseCreate
) -> tuple[TransactionOut, bool]:
    return _create(db, clock, user_id, TransactionType.expense, data)


# ---- read, edit, delete -----------------------------------------------------------------


def get_transaction(db: Session, user_id: uuid.UUID, transaction_id: uuid.UUID) -> TransactionOut:
    row = transaction_repository.get_owned(db, user_id, transaction_id)
    if row is None:
        raise NotFound()
    return _out(db, user_id, row)


def update_transaction(
    db: Session,
    clock: Clock,
    user_id: uuid.UUID,
    transaction_id: uuid.UUID,
    data: TransactionUpdate,
) -> TransactionOut:
    row = transaction_repository.get_owned(db, user_id, transaction_id, for_update=True)
    if row is None:
        raise NotFound()
    if row.related_transaction_id is not None:
        raise FeeManagedByParent()
    if data.type is not None and data.type != row.type:
        raise TypeImmutable()
    if row.type == TransactionType.transfer:
        return transfer_service.update_transfer(
            db, clock, user_id, transaction_id, _as_transfer_update(data)
        )
    check_version(row, data.version)

    changes = data.model_dump(exclude_unset=True, exclude={"version", "type"})
    fee_changes = {k: changes.pop(k) for k in ("fee_amount", "fee_account_id") if k in changes}
    new_date = changes.get("transaction_date", row.transaction_date)
    new_account = changes.get("account_id", row.account_id)
    changed_accounts = {new_account} if new_account != row.account_id else set()
    involved = {new_account}
    final_fee = fee_changes.get("fee_amount", row.fee_amount)
    if row.type == TransactionType.expense and final_fee > 0:
        # Include the fee's account in the same ordered lock (see _create).
        existing_fee = transaction_repository.fees_for_parents(db, [row.id]).get(row.id)
        fee_account = (
            fee_changes.get("fee_account_id")
            or (existing_fee.account_id if existing_fee else None)
            or new_account
        )
        involved.add(fee_account)
        if existing_fee is None or existing_fee.account_id != fee_account:
            changed_accounts.add(fee_account)
    validate_accounts(db, user_id, involved, new_date, changed_accounts)

    if "category_id" in changes:
        category_id = changes["category_id"]
        if category_id is None:
            if row.type == TransactionType.expense:
                raise BusinessRuleError("validation_error", "Choose a category.")
        else:
            expected = (
                CategoryType.income if row.type == TransactionType.income else CategoryType.expense
            )
            category_service.require_category(db, user_id, category_id, expected)

    for field, value in changes.items():
        setattr(row, field, value)
    if row.type == TransactionType.expense and (fee_changes or row.fee_amount > 0):
        # A payment's fee follows its parent (date, name) and any change to its own amount/account.
        transfer_service.sync_fee(
            db,
            clock,
            user_id,
            row,
            fee_amount=fee_changes.get("fee_amount", row.fee_amount),
            fee_account_id=fee_changes.get("fee_account_id"),
        )
    row.version += 1
    row.updated_at = clock.now()
    db.commit()
    logger.info("transaction_updated id=%s", row.id)
    return _out(db, user_id, row)


def _as_transfer_update(data: TransactionUpdate) -> TransferUpdate:
    """The generic edit endpoint also edits transfers; map its fields onto the transfer ones."""
    values = data.model_dump(exclude_unset=True, exclude={"type", "category_id"})
    if "account_id" in values:
        values["source_account_id"] = values.pop("account_id")
    return TransferUpdate(**values)


def delete_transaction(db: Session, user_id: uuid.UUID, transaction_id: uuid.UUID) -> None:
    row = transaction_repository.get_owned(db, user_id, transaction_id, for_update=True)
    if row is None:
        raise NotFound()
    if row.related_transaction_id is not None:
        raise FeeManagedByParent()
    transaction_repository.delete(db, row)  # a linked fee goes with it (ON DELETE CASCADE)
    db.commit()
    logger.info("transaction_deleted id=%s", transaction_id)


def list_transactions(
    db: Session,
    user_id: uuid.UUID,
    filters: TransactionFilters,
    sort_by: str,
    sort_order: str,
    page: int,
    page_size: int,
) -> TransactionPage:
    if (
        filters.start_date is not None
        and filters.end_date is not None
        and filters.start_date > filters.end_date
    ):
        raise BusinessRuleError("validation_error", "The start date is after the end date.")
    rows = transaction_repository.list_page(
        db, user_id, filters, sort_by, sort_order, page, page_size
    )
    return TransactionPage(
        items=build_outs(db, user_id, list(rows)),
        page=page,
        page_size=page_size,
        total=transaction_repository.count(db, user_id, filters),
    )
