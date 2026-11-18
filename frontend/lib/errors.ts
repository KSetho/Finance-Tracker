/** Application errors (mirrors backend/app/core/exceptions.py). Rendered by lib/http.ts. */

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidCredentials extends AppError {
  constructor() {
    super(401, 'invalid_credentials', 'Invalid email or password.');
  }
}

export class Unauthenticated extends AppError {
  constructor() {
    super(401, 'unauthenticated', 'Please sign in.');
  }
}

export class CsrfFailed extends AppError {
  constructor() {
    super(403, 'csrf_failed', 'Request could not be verified.');
  }
}

export class OriginNotAllowed extends AppError {
  constructor() {
    super(403, 'origin_not_allowed', 'Request origin is not allowed.');
  }
}

export class NotFound extends AppError {
  constructor() {
    super(404, 'not_found', 'Not found.');
  }
}

export class IdConflict extends AppError {
  constructor() {
    super(409, 'id_conflict', 'That id is already used by a different record.');
  }
}

export class StaleVersion extends AppError {
  constructor() {
    super(409, 'stale_version', 'This entry changed on another device. Reload it and try again.');
  }
}

export class FeeManagedByParent extends AppError {
  constructor() {
    super(
      409,
      'fee_managed_by_parent',
      'A fee is managed by its transfer or payment. Edit or delete that instead.',
    );
  }
}

export class TypeImmutable extends AppError {
  constructor() {
    super(
      409,
      'type_immutable',
      'The type of an entry cannot be changed. Delete it and add a new one.',
    );
  }
}

/** A well-formed request that breaks a business rule (422). */
export class BusinessRuleError extends AppError {
  constructor(code: string, message: string) {
    super(422, code, message);
  }
}

export class TooManyAttempts extends AppError {
  readonly retryAfter: number;

  constructor(retryAfter: number) {
    const seconds = Math.max(1, retryAfter);
    super(429, 'too_many_attempts', 'Too many attempts. Try again later.', {
      'Retry-After': String(seconds),
    });
    this.retryAfter = seconds;
  }
}

export class InvalidResetToken extends AppError {
  constructor() {
    super(400, 'invalid_reset_token', 'This password reset link is invalid or has expired.');
  }
}

export class InvalidWipeCode extends AppError {
  constructor() {
    super(400, 'invalid_wipe_code', 'That verification code is invalid or has expired.');
  }
}

export class ServiceUnavailable extends AppError {
  constructor(message = 'This action is temporarily unavailable.') {
    super(503, 'service_unavailable', message);
  }
}

/** Malformed request body, query or path (FastAPI's RequestValidationError). */
export class RequestValidationError extends AppError {
  constructor() {
    super(422, 'validation_error', 'Invalid request.');
  }
}
