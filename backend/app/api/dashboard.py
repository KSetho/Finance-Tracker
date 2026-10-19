import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.dependencies.auth import current_owner
from app.dependencies.db import get_db
from app.dependencies.settings import get_clock
from app.schemas.dashboard import (
    CashFlow,
    DashboardSummary,
    RecentTransactions,
    SpendingByCategory,
    TransactionCalendar,
)
from app.services import dashboard_service
from app.services.auth_service import AuthContext

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary", response_model=DashboardSummary)
def summary(
    month: str | None = Query(default=None, max_length=7),
    context: AuthContext = Depends(current_owner),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> DashboardSummary:
    return dashboard_service.summary(db, clock, context.user_id, month)


@router.get("/spending-by-category", response_model=SpendingByCategory)
def spending_by_category(
    month: str | None = Query(default=None, max_length=7),
    start_date: date | None = None,
    end_date: date | None = None,
    context: AuthContext = Depends(current_owner),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> SpendingByCategory:
    return dashboard_service.spending_by_category(
        db, clock, context.user_id, month, start_date, end_date
    )


@router.get("/cash-flow", response_model=CashFlow)
def cash_flow(
    start_date: date,
    end_date: date,
    category_id: uuid.UUID | None = None,
    context: AuthContext = Depends(current_owner),
    db: Session = Depends(get_db),
) -> CashFlow:
    return dashboard_service.cash_flow(db, context.user_id, start_date, end_date, category_id)


@router.get("/calendar", response_model=TransactionCalendar)
def transaction_calendar(
    month: str = Query(max_length=7),
    context: AuthContext = Depends(current_owner),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> TransactionCalendar:
    return dashboard_service.transaction_calendar(db, clock, context.user_id, month)


@router.get("/recent-transactions", response_model=RecentTransactions)
def recent_transactions(
    limit: int = Query(default=10, ge=1, le=50),
    context: AuthContext = Depends(current_owner),
    db: Session = Depends(get_db),
) -> RecentTransactions:
    return dashboard_service.recent_transactions(db, context.user_id, limit)
