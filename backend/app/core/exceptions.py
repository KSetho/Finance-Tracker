from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class AppError(Exception):
    status_code = 500
    code = "internal_error"
    message = "Something went wrong."

    def __init__(self, message: str | None = None, headers: dict[str, str] | None = None):
        super().__init__(message or self.message)
        self.message = message or self.message
        self.headers = headers or {}


class InvalidCredentials(AppError):
    status_code = 401
    code = "invalid_credentials"
    message = "Invalid email or password."


class Unauthenticated(AppError):
    status_code = 401
    code = "unauthenticated"
    message = "Please sign in."


class CsrfFailed(AppError):
    status_code = 403
    code = "csrf_failed"
    message = "Request could not be verified."


class OriginNotAllowed(AppError):
    status_code = 403
    code = "origin_not_allowed"
    message = "Request origin is not allowed."


class NotFound(AppError):
    status_code = 404
    code = "not_found"
    message = "Not found."


class IdConflict(AppError):
    status_code = 409
    code = "id_conflict"
    message = "That id is already used by a different record."


class StaleVersion(AppError):
    status_code = 409
    code = "stale_version"
    message = "This entry changed on another device. Reload it and try again."


class FeeManagedByParent(AppError):
    status_code = 409
    code = "fee_managed_by_parent"
    message = "A fee is managed by its transfer or payment. Edit or delete that instead."


class TypeImmutable(AppError):
    status_code = 409
    code = "type_immutable"
    message = "The type of an entry cannot be changed. Delete it and add a new one."


class BusinessRuleError(AppError):
    """A well-formed request that breaks a business rule (422)."""

    status_code = 422

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class TooManyAttempts(AppError):
    status_code = 429
    code = "too_many_attempts"
    message = "Too many attempts. Try again later."

    def __init__(self, retry_after: int):
        super().__init__(headers={"Retry-After": str(max(1, retry_after))})
        self.retry_after = max(1, retry_after)


class InvalidResetToken(AppError):
    status_code = 400
    code = "invalid_reset_token"
    message = "This password reset link is invalid or has expired."


class InvalidWipeCode(AppError):
    status_code = 400
    code = "invalid_wipe_code"
    message = "That verification code is invalid or has expired."


class ServiceUnavailable(AppError):
    status_code = 503
    code = "service_unavailable"
    message = "This action is temporarily unavailable."


def _body(code: str, message: str) -> dict:
    return {"error": {"code": code, "message": message}}


def install_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            _body(exc.code, exc.message), status_code=exc.status_code, headers=exc.headers
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(_: Request, __: RequestValidationError) -> JSONResponse:
        return JSONResponse(_body("validation_error", "Invalid request."), status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_exception(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {404: "not_found", 405: "method_not_allowed"}.get(exc.status_code, "http_error")
        return JSONResponse(
            _body(code, "Request failed."), status_code=exc.status_code, headers=exc.headers
        )
