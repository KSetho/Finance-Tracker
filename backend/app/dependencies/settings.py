from fastapi import Request

from app.core.clock import Clock
from app.core.config import Settings
from app.core.email import PasswordResetSender


def get_app_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_clock(request: Request) -> Clock:
    return request.app.state.clock


def get_password_reset_sender(request: Request) -> PasswordResetSender:
    return request.app.state.password_reset_sender
