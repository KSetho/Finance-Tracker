import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class LoginRequest(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(min_length=1, max_length=1024)

    @field_validator("email")
    @classmethod
    def _email_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("email must not be blank")
        return value


class UserOut(BaseModel):
    id: uuid.UUID
    email: str


class SessionResponse(BaseModel):
    user: UserOut
    csrf_token: str
    expires_at: datetime


class ForgotPasswordRequest(BaseModel):
    email: str = Field(max_length=320)

    @field_validator("email")
    @classmethod
    def _email_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("email must not be blank")
        return value


class ForgotPasswordResponse(BaseModel):
    message: str


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=1, max_length=512)
    password: str = Field(min_length=10, max_length=1024)


class ErrorBody(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorBody
