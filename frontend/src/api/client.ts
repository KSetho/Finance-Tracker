export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfter: number | null;

  constructor(status: number, code: string, message: string, retryAfter: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

// The CSRF token lives in memory only; it is re-issued by /auth/me after a reload.
let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

// Called when an authenticated request comes back 401 (session expired or revoked).
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Set for calls where a 401 is an expected answer (sign in, session check, sign out). */
  skipUnauthorizedHandler?: boolean;
};

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (UNSAFE_METHODS.has(method) && csrfToken) headers["X-CSRF-Token"] = csrfToken;

  let response: Response;
  try {
    response = await fetch(new URL(`/api/v1${path}`, window.location.origin), {
      method,
      headers,
      credentials: "same-origin",
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, "network_error", "Could not reach the server. Check your connection.");
  }

  if (response.ok) {
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  if (response.status === 401 && !options.skipUnauthorizedHandler) unauthorizedHandler?.();

  let code = "http_error";
  let message = "Something went wrong. Please try again.";
  try {
    const payload = await response.json();
    code = payload?.error?.code ?? code;
    message = payload?.error?.message ?? message;
  } catch {
    // non-JSON error body: keep the generic message
  }
  const retryHeader = response.headers.get("Retry-After");
  const retryAfter = retryHeader ? Number.parseInt(retryHeader, 10) : null;
  throw new ApiError(response.status, code, message, Number.isNaN(retryAfter) ? null : retryAfter);
}
