import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, StringConstraints, field_validator, model_validator

from app.models import TransactionType
from app.schemas.category import CategoryOut
from app.schemas.common import Money, NonNegativeMoney, PositiveMoney

TxName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
TxDescription = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]


def _blank_to_none(value: str | None) -> str | None:
    return value or None


class AccountRef(BaseModel):
    id: uuid.UUID
    name: str


class FeeRef(BaseModel):
    id: uuid.UUID
    amount: Money
    account: AccountRef


class TransactionOut(BaseModel):
    id: uuid.UUID
    type: TransactionType
    name: str
    description: str | None
    amount: Money
    transaction_date: date
    account: AccountRef
    destination_account: AccountRef | None
    category: CategoryOut | None
    fee_amount: Money
    fee: FeeRef | None
    is_fee: bool
    related_transaction_id: uuid.UUID | None
    version: int
    created_at: datetime
    updated_at: datetime


class TransactionPage(BaseModel):
    items: list[TransactionOut]
    page: int
    page_size: int
    total: int


class IncomeCreate(BaseModel):
    id: uuid.UUID | None = None  # client-generated, makes retries idempotent
    name: TxName
    description: TxDescription | None = None
    amount: PositiveMoney
    transaction_date: date
    account_id: uuid.UUID
    category_id: uuid.UUID | None = None

    _description = field_validator("description")(_blank_to_none)


class ExpenseCreate(BaseModel):
    id: uuid.UUID | None = None
    name: TxName
    description: TxDescription | None = None
    amount: PositiveMoney
    transaction_date: date
    account_id: uuid.UUID
    category_id: uuid.UUID
    # A payment to another person: the optional fee becomes one linked expense.
    fee_amount: NonNegativeMoney = Decimal("0.00")
    fee_account_id: uuid.UUID | None = None  # defaults to account_id

    _description = field_validator("description")(_blank_to_none)


class TransactionUpdate(BaseModel):
    """Partial edit. `version` is the last value read; `type` may be sent but is never changed."""

    version: int
    type: TransactionType | None = None
    name: TxName | None = None
    description: TxDescription | None = None
    amount: PositiveMoney | None = None
    transaction_date: date | None = None
    account_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    fee_amount: NonNegativeMoney | None = None
    fee_account_id: uuid.UUID | None = None

    _description = field_validator("description")(_blank_to_none)

    @model_validator(mode="after")
    def _only_nullable_fields_may_be_null(self) -> "TransactionUpdate":
        nullable = {"description", "category_id", "type"}
        for field in self.model_fields_set - nullable - {"version"}:
            if getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class TransferCreate(BaseModel):
    id: uuid.UUID | None = None  # client-generated, makes retries idempotent
    name: TxName
    description: TxDescription | None = None
    amount: PositiveMoney
    transaction_date: date
    source_account_id: uuid.UUID
    destination_account_id: uuid.UUID
    fee_amount: NonNegativeMoney = Decimal("0.00")
    fee_account_id: uuid.UUID | None = None  # source or destination; defaults to the source

    _description = field_validator("description")(_blank_to_none)


class TransferUpdate(BaseModel):
    version: int
    name: TxName | None = None
    description: TxDescription | None = None
    amount: PositiveMoney | None = None
    transaction_date: date | None = None
    source_account_id: uuid.UUID | None = None
    destination_account_id: uuid.UUID | None = None
    fee_amount: NonNegativeMoney | None = None
    fee_account_id: uuid.UUID | None = None

    _description = field_validator("description")(_blank_to_none)

    @model_validator(mode="after")
    def _only_description_may_be_null(self) -> "TransferUpdate":
        for field in self.model_fields_set - {"description", "version"}:
            if getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


ZERO = Decimal("0.00")
