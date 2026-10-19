import uuid
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.dependencies.auth import current_owner
from app.dependencies.csrf import require_csrf
from app.dependencies.db import get_db
from app.dependencies.settings import get_clock
from app.models import TransactionType
from app.repositories.transaction_repository import TransactionFilters
from app.schemas.common import PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX
from app.schemas.transaction import (
    ExpenseCreate,
    IncomeCreate,
    TransactionOut,
    TransactionPage,
    TransactionUpdate,
)
from app.services import transaction_service
from app.services.auth_service import AuthContext

router = APIRouter(
    prefix="/transactions", tags=["transactions"], dependencies=[Depends(require_csrf)]
)


@router.get("", response_model=TransactionPage)
def list_transactions(
    start_date: date | None = None,
    end_date: date | None = None,
    type: TransactionType | None = None,
    category_id: uuid.UUID | None = None,
    account_id: uuid.UUID | None = None,
    q: str | None = Query(default=None, max_length=120),
    sort_by: Literal["transaction_date", "amount"] = "transaction_date",
    sort_order: Literal["asc", "desc"] = "desc",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=PAGE_SIZE_DEFAULT, ge=1, le=PAGE_SIZE_MAX),
    context: AuthContext = Depends(current_owner),
    db: Session = Depends(get_db),
) -> TransactionPage:
    filters = TransactionFilters(
        start_date=start_date,
        end_date=end_date,
        type=type,
        category_id=category_id,
        account_id=account_id,
        q=q or None,
    )
    return transaction_service.list_transactions(
        db, context.user_id, filters, sort_by, sort_order, page, page_size
    )


@router.post("/income", response_model=TransactionOut, status_code=status.HTTP_201_CREATED)
def create_income(
    payload: IncomeCreate,
    response: Response,
    context: AuthContext = Depends(current_owner),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> TransactionOut:
    created, is_new = transaction_service.create_income(db, clock, context.user_id, payload)
    if not is_new:
        response.status_code = status.HTTP_200_OK
    return created


@router.post("/expenses", response_model=TransactionOut, status_code=status.HTTP_201_CREATED)
def create_expense(
    payload: ExpenseCreate,
    response: Response,
    context: AuthContext = Depends(current_owner),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> TransactionOut:
    created, is_new = transaction_service.create_expense(db, clock, context.user_id, payload)
    if not is_new:
        response.status_code = status.HTTP_200_OK
    return created


@router.get("/{transaction_id}", response_model=TransactionOut)
def get_transaction(
    transaction_id: uuid.UUID,
    context: AuthContext = Depends(current_owner),
    db: Session = Depends(get_db),
) -> TransactionOut:
    return transaction_service.get_transaction(db, context.user_id, transaction_id)


@router.patch("/{transaction_id}", response_model=TransactionOut)
def update_transaction(
    transaction_id: uuid.UUID,
    payload: TransactionUpdate,
    context: AuthContext = Depends(current_owner),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> TransactionOut:
    return transaction_service.update_transaction(
        db, clock, context.user_id, transaction_id, payload
    )


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(
    transaction_id: uuid.UUID,
    context: AuthContext = Depends(current_owner),
    db: Session = Depends(get_db),
) -> Response:
    transaction_service.delete_transaction(db, context.user_id, transaction_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
