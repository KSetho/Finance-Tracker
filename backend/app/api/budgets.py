from datetime import date

from fastapi import APIRouter, Depends, Path, Query
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.dependencies.auth import current_owner
from app.dependencies.csrf import require_csrf
from app.dependencies.db import get_db
from app.dependencies.settings import get_clock
from app.schemas.budget import BudgetList, BudgetSummary, BudgetUpdate
from app.services import budget_service
from app.services.auth_service import AuthContext

router = APIRouter(prefix="/budgets", tags=["budgets"], dependencies=[Depends(require_csrf)])

Year = Path(ge=2000, le=2100)
Month = Path(ge=1, le=12)


@router.get("", response_model=BudgetList)
def list_budgets(
    first: str | None = Query(default=None, alias="from", max_length=7),
    last: str | None = Query(default=None, alias="to", max_length=7),
    context: AuthContext = Depends(current_owner),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> BudgetList:
    return budget_service.list_months(db, clock, context.user_id, first, last)


@router.get("/{year}/{month}", response_model=BudgetSummary)
def get_budget(
    year: int = Year,
    month: int = Month,
    context: AuthContext = Depends(current_owner),
    db: Session = Depends(get_db),
) -> BudgetSummary:
    return budget_service.get_month(db, context.user_id, date(year, month, 1))


@router.put("/{year}/{month}", response_model=BudgetSummary)
def put_budget(
    payload: BudgetUpdate,
    year: int = Year,
    month: int = Month,
    context: AuthContext = Depends(current_owner),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> BudgetSummary:
    return budget_service.set_allowance(
        db, clock, context.user_id, date(year, month, 1), payload.allowance
    )
