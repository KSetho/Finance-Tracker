from pydantic import BaseModel

from app.schemas.common import Money, NonNegativeMoney


class BudgetUpdate(BaseModel):
    allowance: NonNegativeMoney


class BudgetSummary(BaseModel):
    month: str  # YYYY-MM
    allowance: Money | None
    total_expenses: Money
    remaining: Money | None  # allowance - total_expenses; negative when over
    percentage_used: str | None  # two decimals; None when the allowance is zero or unset
    is_over_budget: bool


class BudgetList(BaseModel):
    items: list[BudgetSummary]
