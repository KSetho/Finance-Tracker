from fastapi import APIRouter, BackgroundTasks, Depends, Response, status
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.config import Settings
from app.core.email import PasswordResetSender
from app.dependencies.auth import current_owner
from app.dependencies.client_ip import client_ip
from app.dependencies.csrf import require_csrf
from app.dependencies.db import get_db
from app.dependencies.settings import get_app_settings, get_clock, get_password_reset_sender
from app.schemas.auth import (
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    LoginRequest,
    ResetPasswordRequest,
    SessionResponse,
)
from app.services import auth_service
from app.services.auth_service import AuthContext

router = APIRouter(prefix="/auth", tags=["auth"])

RESET_REQUEST_MESSAGE = "If the account exists, a password reset link has been sent."


@router.post(
    "/forgot-password",
    response_model=ForgotPasswordResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def forgot_password(
    payload: ForgotPasswordRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
    clock: Clock = Depends(get_clock),
    sender: PasswordResetSender = Depends(get_password_reset_sender),
    source_ip: str = Depends(client_ip),
) -> dict[str, str]:
    # Return the generic response before SMTP work so delivery/account state cannot be inferred
    # from request latency. FastAPI keeps yielded dependencies alive until background tasks finish.
    background_tasks.add_task(
        auth_service.request_password_reset,
        db,
        settings,
        clock,
        sender,
        email=payload.email,
        source_ip=source_ip,
    )
    return {"message": RESET_REQUEST_MESSAGE}


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(
    payload: ResetPasswordRequest,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
    clock: Clock = Depends(get_clock),
) -> Response:
    auth_service.reset_password_with_token(
        db,
        settings,
        clock,
        token=payload.token,
        password=payload.password,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/login", response_model=SessionResponse)
def login(
    payload: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
    clock: Clock = Depends(get_clock),
    source_ip: str = Depends(client_ip),
) -> dict:
    result = auth_service.login(
        db,
        settings,
        clock,
        email=payload.email,
        password=payload.password,
        source_ip=source_ip,
    )
    response.set_cookie(
        key=settings.session_cookie_name,
        value=result.token,
        max_age=result.max_age_seconds,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    return {
        "user": {"id": result.user.id, "email": result.user.email},
        "csrf_token": result.csrf_token,
        "expires_at": result.expires_at,
    }


@router.get("/me", response_model=SessionResponse)
def me(
    context: AuthContext = Depends(current_owner),
    settings: Settings = Depends(get_app_settings),
) -> dict:
    return auth_service.session_response_payload(context, settings)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    context: AuthContext = Depends(current_owner),
    _csrf: None = Depends(require_csrf),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
    clock: Clock = Depends(get_clock),
) -> Response:
    auth_service.logout(db, clock, context)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(
        key=settings.session_cookie_name,
        path="/",
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
    )
    return response
