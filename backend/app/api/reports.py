from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.config import Settings
from app.core.email import PasswordResetSender
from app.dependencies.auth import current_owner
from app.dependencies.client_ip import client_ip
from app.dependencies.csrf import require_csrf
from app.dependencies.db import get_db
from app.dependencies.settings import get_app_settings, get_clock, get_password_reset_sender
from app.schemas.report import TransactionCsvReportRequest, TransactionCsvReportResponse
from app.services import report_service
from app.services.auth_service import AuthContext

router = APIRouter(
    prefix="/reports",
    tags=["reports"],
    dependencies=[Depends(require_csrf)],
)


@router.post(
    "/transactions-csv",
    response_model=TransactionCsvReportResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def email_transactions_csv(
    payload: TransactionCsvReportRequest,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
    clock: Clock = Depends(get_clock),
    sender: PasswordResetSender = Depends(get_password_reset_sender),
    context: AuthContext = Depends(current_owner),
    source_ip: str = Depends(client_ip),
) -> dict[str, str]:
    return report_service.email_transactions_csv(
        db,
        settings,
        clock,
        sender,
        context,
        start_date=payload.start_date,
        end_date=payload.end_date,
        source_ip=source_ip,
    )
