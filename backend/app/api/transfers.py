import uuid

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.dependencies.auth import current_owner
from app.dependencies.csrf import require_csrf
from app.dependencies.db import get_db
from app.dependencies.settings import get_clock
from app.schemas.transaction import TransactionOut, TransferCreate, TransferUpdate
from app.services import transfer_service
from app.services.auth_service import AuthContext

router = APIRouter(prefix="/transfers", tags=["transfers"], dependencies=[Depends(require_csrf)])


@router.post("", response_model=TransactionOut, status_code=status.HTTP_201_CREATED)
def create_transfer(
    payload: TransferCreate,
    response: Response,
    context: AuthContext = Depends(current_owner),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> TransactionOut:
    created, is_new = transfer_service.create_transfer(db, clock, context.user_id, payload)
    if not is_new:
        response.status_code = status.HTTP_200_OK
    return created


@router.get("/{transfer_id}", response_model=TransactionOut)
def get_transfer(
    transfer_id: uuid.UUID,
    context: AuthContext = Depends(current_owner),
    db: Session = Depends(get_db),
) -> TransactionOut:
    return transfer_service.get_transfer(db, context.user_id, transfer_id)


@router.patch("/{transfer_id}", response_model=TransactionOut)
def update_transfer(
    transfer_id: uuid.UUID,
    payload: TransferUpdate,
    context: AuthContext = Depends(current_owner),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> TransactionOut:
    return transfer_service.update_transfer(db, clock, context.user_id, transfer_id, payload)


@router.delete("/{transfer_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transfer(
    transfer_id: uuid.UUID,
    context: AuthContext = Depends(current_owner),
    db: Session = Depends(get_db),
) -> Response:
    transfer_service.delete_transfer(db, context.user_id, transfer_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
