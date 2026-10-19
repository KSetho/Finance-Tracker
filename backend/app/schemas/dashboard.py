import uuid
from typing import Literal

from pydantic import BaseModel

from app.schemas.account import AccountOut
from app.schemas.budget import BudgetSummary
from app.schemas.common import Money
from app.schemas.transaction import TransactionOut


class DashboardSummary(BaseModel):
    month: str
    currency: Literal["GHS"] = "GHS"
    total_income: Money
    total_expenses: Money  # fees included
    fee_total: Money  # a subset of total_expenses
    net_cash_flow: Money
    budget: BudgetSummary
    combined_balance: Money
    accounts: list[AccountOut]


class CategorySpend(BaseModel):
    category_id: uuid.UUID | None
    name: str
    amount: Money
    share_percent: str  # two decimals; the shares add up to 100.00


class SpendingByCategory(BaseModel):
    total_expenses: Money
    items: list[CategorySpend]


class CashFlowBucket(BaseModel):
    period: str
    income: Money
    expenses: Money


class CashFlow(BaseModel):
    group_by: Literal["day", "month"]
    income: Money
    expenses: Money
    net: Money
    buckets: list[CashFlowBucket]


class CalendarDay(BaseModel):
    date: str
    income: Money
    expenses: Money
    net: Money
    transaction_count: int


class TransactionCalendar(BaseModel):
    month: str
    days: list[CalendarDay]


class RecentTransactions(BaseModel):
    items: list[TransactionOut]
