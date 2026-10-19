import logging
import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.exceptions import BusinessRuleError, IdConflict, NotFound
from app.models import Account
from app.repositories import account_repository
from app.schemas.account import AccountCreate, AccountList, AccountOut, AccountUpdate
from app.services import accounting

DUPLICATE_NAME = "An account with this name already exists."

logger = logging.getLogger("app.finance")


def _out(account: Account, balance) -> AccountOut:
    return AccountOut(
        id=account.id,
        name=account.name,
        account_type=account.account_type,
        opening_balance=account.opening_balance,
        opening_date=account.opening_date,
        is_archived=account.is_archived,
        balance=balance,
        created_at=account.created_at,
        updated_at=account.updated_at,
    )


def _view(db: Session, user_id: uuid.UUID, account: Account) -> AccountOut:
    balance = accounting.account_balances(db, user_id, {account.id})[account.id]
    return _out(account, balance)


def _same_fields(account: Account, data: AccountCreate) -> bool:
    return (
        account.name == data.name
        and account.account_type == data.account_type
        and account.opening_balance == data.opening_balance
        and account.opening_date == data.opening_date
    )


def list_accounts(db: Session, user_id: uuid.UUID, include_archived: bool) -> AccountList:
    accounts = account_repository.list_for_user(db, user_id, include_archived)
    balances = accounting.account_balances(db, user_id, {a.id for a in accounts})
    return AccountList(
        items=[_out(a, balances[a.id]) for a in accounts],
        combined_balance=accounting.combined_balance(db, user_id),
    )


def get_account(db: Session, user_id: uuid.UUID, account_id: uuid.UUID) -> AccountOut:
    account = account_repository.get_owned(db, user_id, account_id)
    if account is None:
        raise NotFound()
    return _view(db, user_id, account)


def create_account(
    db: Session, clock: Clock, user_id: uuid.UUID, data: AccountCreate
) -> tuple[AccountOut, bool]:
    """Returns (account, created). A retry with the same id and fields returns the original."""
    if data.id is not None:
        existing = account_repository.get_owned(db, user_id, data.id)
        if existing is not None:
            if _same_fields(existing, data):
                return _view(db, user_id, existing), False
            raise IdConflict()
    if account_repository.name_exists(db, user_id, data.name):
        raise BusinessRuleError("validation_error", DUPLICATE_NAME)

    now = clock.now()
    account = Account(
        id=data.id or uuid.uuid4(),
        user_id=user_id,
        name=data.name,
        account_type=data.account_type,
        opening_balance=data.opening_balance,
        opening_date=data.opening_date,
        created_at=now,
        updated_at=now,
    )
    try:
        account_repository.add(db, account)
        db.commit()
        logger.info("account_created id=%s", account.id)
    except IntegrityError as exc:
        db.rollback()
        # A parallel request with the same id, or the same name, won the race.
        raced = account_repository.get_owned(db, user_id, data.id) if data.id else None
        if raced is not None and _same_fields(raced, data):
            return _view(db, user_id, raced), False
        if (
            raced is not None
            or data.id is not None
            and not account_repository.name_exists(db, user_id, data.name)
        ):
            raise IdConflict() from exc
        raise BusinessRuleError("validation_error", DUPLICATE_NAME) from exc
    return _view(db, user_id, account), True


def update_account(
    db: Session, clock: Clock, user_id: uuid.UUID, account_id: uuid.UUID, data: AccountUpdate
) -> AccountOut:
    account = account_repository.get_owned(db, user_id, account_id, for_update=True)
    if account is None:
        raise NotFound()
    changes = data.model_dump(exclude_unset=True)

    if "name" in changes and account_repository.name_exists(
        db, user_id, changes["name"], exclude_id=account.id
    ):
        raise BusinessRuleError("validation_error", DUPLICATE_NAME)

    if "opening_date" in changes:
        earliest = account_repository.earliest_activity_date(db, account.id)
        if earliest is not None and changes["opening_date"] > earliest:
            raise BusinessRuleError(
                "activity_before_opening_date",
                "This account has activity before that date. Choose an earlier opening date.",
            )

    for field, value in changes.items():
        setattr(account, field, value)
    account.updated_at = clock.now()
    db.commit()
    return _view(db, user_id, account)


def archive_account(
    db: Session, clock: Clock, user_id: uuid.UUID, account_id: uuid.UUID
) -> AccountOut:
    account = account_repository.get_owned(db, user_id, account_id, for_update=True)
    if account is None:
        raise NotFound()
    if not account.is_archived:
        account.is_archived = True
        account.updated_at = clock.now()
        db.commit()
        logger.info("account_archived id=%s", account.id)
    return _view(db, user_id, account)
