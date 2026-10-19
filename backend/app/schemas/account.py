import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, StringConstraints, model_validator

from app.models import AccountType
from app.schemas.common import Money, NonNegativeMoney

AccountName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


class AccountCreate(BaseModel):
    id: uuid.UUID | None = None  # client-generated, makes retries idempotent
    name: AccountName
    account_type: AccountType
    opening_balance: NonNegativeMoney = Decimal("0.00")
    opening_date: date


class AccountUpdate(BaseModel):
    name: AccountName | None = None
    opening_balance: NonNegativeMoney | None = None
    opening_date: date | None = None

    @model_validator(mode="after")
    def _no_nulls(self) -> "AccountUpdate":
        for field in self.model_fields_set:
            if getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class AccountOut(BaseModel):
    id: uuid.UUID
    name: str
    account_type: AccountType
    opening_balance: Money
    opening_date: date
    is_archived: bool
    balance: Money
    created_at: datetime
    updated_at: datetime


class AccountList(BaseModel):
    items: list[AccountOut]
    combined_balance: Money
