import uuid

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.dependencies.auth import current_owner
from app.dependencies.csrf import require_csrf
from app.dependencies.db import get_db
from app.dependencies.settings import get_clock
from app.schemas.account import AccountCreate, AccountList, AccountOut, AccountUpdate
from app.services import account_service
from app.services.auth_service import AuthContext

router = APIRouter(prefix="/accounts", tags=["accounts"], dependencies=[Depends(require_csrf)])


@router.get("", response_model=AccountList)
def list_accounts(
    include_archived: bool = Query(default=False),
    context: AuthContext = Depends(current_owner),
    db: Session = Depends(get_db),
) -> AccountList:
    return account_service.list_accounts(db, context.user_id, include_archived)


@router.post("", response_model=AccountOut, status_code=status.HTTP_201_CREATED)
def create_account(
    payload: AccountCreate,
    response: Response,
    context: AuthContext = Depends(current_owner),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> AccountOut:
    account, created = account_service.create_account(db, clock, context.user_id, payload)
    if not created:
        response.status_code = status.HTTP_200_OK
    return account


@router.get("/{account_id}", response_model=AccountOut)
def get_account(
    account_id: uuid.UUID,
    context: AuthContext = Depends(current_owner),
    db: Session = Depends(get_db),
) -> AccountOut:
    return account_service.get_account(db, context.user_id, account_id)


@router.patch("/{account_id}", response_model=AccountOut)
def update_account(
    account_id: uuid.UUID,
    payload: AccountUpdate,
    context: AuthContext = Depends(current_owner),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> AccountOut:
    return account_service.update_account(db, clock, context.user_id, account_id, payload)


@router.post("/{account_id}/archive", response_model=AccountOut)
def archive_account(
    account_id: uuid.UUID,
    context: AuthContext = Depends(current_owner),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> AccountOut:
    return account_service.archive_account(db, clock, context.user_id, account_id)
