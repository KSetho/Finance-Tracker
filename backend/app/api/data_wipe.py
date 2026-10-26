from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.config import Settings
from app.core.email import PasswordResetSender
from app.dependencies.auth import current_owner
from app.dependencies.client_ip import client_ip
from app.dependencies.csrf import require_csrf
from app.dependencies.db import get_db
from app.dependencies.settings import get_app_settings, get_clock, get_password_reset_sender
from app.schemas.data_wipe import DataWipeConfirmRequest, DataWipeRequestResponse
from app.services import data_wipe_service
from app.services.auth_service import AuthContext

router = APIRouter(
    prefix="/data-wipe",
    tags=["data-wipe"],
    dependencies=[Depends(require_csrf)],
)


@router.post(
    "/request",
    response_model=DataWipeRequestResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def request_data_wipe(
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
    clock: Clock = Depends(get_clock),
    sender: PasswordResetSender = Depends(get_password_reset_sender),
    context: AuthContext = Depends(current_owner),
    source_ip: str = Depends(client_ip),
) -> dict[str, str]:
    return data_wipe_service.request_wipe(
        db, settings, clock, sender, context, source_ip=source_ip
    )


@router.post("/confirm", status_code=status.HTTP_204_NO_CONTENT)
def confirm_data_wipe(
    payload: DataWipeConfirmRequest,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
    clock: Clock = Depends(get_clock),
    context: AuthContext = Depends(current_owner),
) -> Response:
    data_wipe_service.confirm_wipe(
        db, settings, clock, context, code=payload.code
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
