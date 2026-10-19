# Research: Owner-Only Authentication and Application Foundation

The stack is fixed by the constitution and product specification (FastAPI, SQLAlchemy 2.x,
Alembic, PostgreSQL, React/TypeScript/Vite). This research resolves the remaining design
choices for increment 001. No `NEEDS CLARIFICATION` items remain.

## R1. Session mechanism

- **Decision**: Server-side sessions. On login, generate a 256-bit random opaque token, set it in
  a secure HTTP-only cookie, and store only its SHA-256 hash in a `sessions` table with
  `expires_at`, `last_seen_at` and `revoked_at`.
- **Rationale**: FR-008 and FR-014 require immediate invalidation on logout and on password
  reset. A stateless signed cookie cannot be revoked before expiry without a server-side
  denylist, which is a session table anyway. Storing only the hash means a database leak does not
  yield usable sessions. Serverless hosting has no shared memory, so the store must be the
  database.
- **Alternatives considered**: Signed stateless cookie / JWT (cannot revoke, rejected); in-memory
  store (lost between serverless invocations, rejected); Redis (extra service, YAGNI for one
  user).

## R2. Session lifetime

- **Decision**: Absolute lifetime 7 days, sliding idle timeout 24 hours, both configurable via
  environment. `last_seen_at` is refreshed at most once per 5 minutes to avoid a write on every
  request.
- **Rationale**: Balances convenience for a personal app with bounded exposure on a lost device.
  The spec leaves values to planning (Assumptions).
- **Alternatives considered**: 30-minute idle (annoying for a personal tracker); 30-day absolute
  (larger exposure window).

## R3. Password hashing

- **Decision**: Argon2id through `argon2-cffi` with library defaults (RFC 9106 low-memory profile),
  with `check_needs_rehash` on successful login.
- **Rationale**: Constitution Principle IV names Argon2id. `argon2-cffi` is maintained and ships
  wheels for the serverless platform.
- **Alternatives considered**: bcrypt (acceptable but not the named algorithm); scrypt (less
  tooling).

## R4. Wrong-email vs wrong-password indistinguishability

- **Decision**: Normalize the email, then always run one Argon2 verification. If the email does
  not match `OWNER_EMAIL` or no active owner record exists, verify against a precomputed dummy hash
  and return the same `invalid_credentials` error.
- **Rationale**: Satisfies FR-004 and SC-004; equalizes timing so an attacker cannot learn
  whether an email is the owner's.
- **Alternatives considered**: Early return on email mismatch (leaks via timing).

## R5. Login throttling storage and policy

- **Decision**: A `login_attempts` table records each failed attempt (source IP, normalized
  email, timestamp). Limits, evaluated over a 15-minute sliding window: 5 failures per source IP,
  and 20 failures per account across all sources. Throttled requests return `429` with
  `Retry-After` and are rejected before password verification. Successful login clears that
  source's failures. Old rows are purged opportunistically on login.
- **Rationale**: In-memory limiters do not work across serverless instances. The per-IP limit
  stops a single attacker quickly; the higher account-wide limit stops distributed guessing while
  being hard for one attacker to use to lock the owner out for long (each source is itself
  capped at 5 per window), satisfying the "cannot lock out indefinitely" edge case. Thresholds are
  configurable.
- **Source IP**: Taken from the platform-supplied forwarded header only when `TRUSTED_PROXY` is
  enabled; otherwise the socket peer. Prevents spoofing the header to evade throttling.
- **Alternatives considered**: `slowapi`/in-memory counters (serverless-incompatible); per-account
  hard lockout only (enables easy owner lockout).

## R6. CSRF protection

- **Decision**: Two layers on every state-changing request (`POST`, `PUT`, `PATCH`, `DELETE`):
  (1) `Origin` (fallback `Referer`) must match the configured frontend origin; (2) a synchronizer
  token header `X-CSRF-Token` equal to `HMAC-SHA256(SECRET_KEY, session_token)`, which the
  frontend receives in the login and `/auth/me` response bodies and holds in memory. Login and
  logout are covered by the Origin check; logout also requires the token because it requires a
  session.
- **Rationale**: Constitution Principle IV requires CSRF protection with cookie auth. The HMAC
  token is bound to the session, needs no extra storage or cookie, and survives page reloads via
  `/auth/me`. `SameSite=Lax` is the third layer.
- **Alternatives considered**: Double-submit cookie (extra cookie, weaker without signing); per-
  request random tokens in the database (state for no gain).

## R7. Cookie settings and origin topology

- **Decision**: Cookie `finance_session` (name from `SESSION_COOKIE_NAME`): `HttpOnly`, `Secure`
  (forced on when `APP_ENV=production`, off only for local HTTP development), `SameSite=Lax`,
  `Path=/`, `Max-Age` equal to the absolute lifetime. The frontend calls the API through same-origin
  `/api` paths: a Vite dev proxy locally and a Vercel rewrite in production. CORS is therefore not
  needed for normal operation; if enabled it is limited to the exact `FRONTEND_ORIGIN`.
- **Rationale**: Same-origin removes cross-site cookie complexity, as the product spec
  recommends.
- **Alternatives considered**: Separate origins with `SameSite=None` (weaker, more config).

## R8. Owner configuration and startup validation

- **Decision**: `pydantic-settings` reads `OWNER_EMAIL`, `DATABASE_URL`, `SECRET_KEY`,
  `SESSION_COOKIE_NAME`, `APP_ENV`, `FRONTEND_ORIGIN` and tuning values. Startup fails fast if
  `OWNER_EMAIL` is missing or malformed, if `SECRET_KEY` is shorter than 32 bytes, or if
  `APP_ENV=production` with a non-HTTPS `FRONTEND_ORIGIN`. Email normalization is one shared
  function (strip, lowercase) used by config, login and provisioning.
- **Rationale**: Edge case "owner email missing or malformed at startup" must never fall back to
  open access.

## R9. Owner storage and single-owner enforcement

- **Decision**: `users.email` is plain text with a `CHECK (email = lower(btrim(email)))` and a
  unique index, rather than `CITEXT`. A unique index on a constant expression
  (`CREATE UNIQUE INDEX users_single_owner ON users ((true))`) limits the table to one row.
- **Rationale**: The product spec allows "CITEXT or normalized text"; normalized text avoids a
  database extension dependency on the managed host. The constant-expression index enforces "one
  owner" in the database, not just in code (Constitution Principle III).
- **Alternatives considered**: `CITEXT` (extension dependency); application-only single-owner
  check (race-prone).

## R10. Administrative provisioning and reset

- **Decision**: A Python CLI module `python -m app.cli` with `provision-owner` and
  `reset-owner-password`. Passwords are read interactively with `getpass` (or from stdin with
  `--password-stdin` for automation), never from a command-line argument. `provision-owner` requires
  the target email to equal `OWNER_EMAIL`, refuses if any user exists. `reset-owner-password`
  updates the hash and revokes all of the owner's sessions in one transaction. Both enforce a
  minimum password length of 7.
- **Rationale**: FR-013 and FR-014. Keeping secrets out of argv keeps them out of shell history and
  process listings.

## R11. Health endpoint

- **Decision**: `GET /api/v1/health` returns `{"status":"ok"}` after a trivial database
  round-trip; if the database is unreachable it returns `503` `{"status":"unavailable"}`. It
  exposes no version, configuration or hostnames.
- **Rationale**: FR-015; useful for deployment checks.

## R12. Error contract

- **Decision**: All errors use `{"error":{"code":"<machine_code>","message":"<human text>"}}`.
  Status codes: `401` (`invalid_credentials`, `unauthenticated`), `403` (`csrf_failed`,
  `origin_not_allowed`), `422` (`validation_error`), `429` (`too_many_attempts`), `503`.
- **Rationale**: Consistent shape lets the frontend show distinct states without parsing text.

## R13. Database access and migrations

- **Decision**: Synchronous SQLAlchemy 2.x with `psycopg` 3. A request-scoped session dependency
  commits or rolls back per request. In serverless (`APP_ENV=production`) use `NullPool` and the
  provider's pooled connection string. Alembic owns the schema; the initial migration creates
  `users`, `sessions` and `login_attempts`.
- **Rationale**: Sync is simpler to test and sufficient for one user. `NullPool` avoids exhausting
  provider connection limits from short-lived serverless workers.
- **Alternatives considered**: Async SQLAlchemy (added complexity, no benefit at this scale).

## R14. Testing approach

- **Decision**: Backend: pytest against a real PostgreSQL started with `docker compose`
  (Constitution Principle V). A session-scoped fixture creates a throwaway test database and runs
  Alembic migrations; each test runs in an isolated transaction or truncates tables. The HTTP
  layer is exercised with FastAPI `TestClient`. Time-dependent behavior (expiry, throttling window)
  uses an injectable clock. Frontend: Vitest + React Testing Library + MSW for the login flow and
  route guards. Lint with Ruff (backend) and ESLint (frontend).
- **Rationale**: Real PostgreSQL is required by the constitution; an injectable clock avoids
  sleeping in tests.

## R15. Frontend foundation

- **Decision**: Vite + React + TypeScript; React Router with a `RequireAuth` layout route;
  TanStack Query for `/auth/me` and mutations; React Hook Form + Zod for the login form; a thin
  `fetch` client that sends credentials, attaches `X-CSRF-Token` from in-memory state, and maps
  `401` to a sign-out redirect. Layout is mobile-first: base CSS targets a phone and `min-width` queries add the desktop
  sidebar. On phones a bottom tab bar holds Home, History, a prominent Add action, Accounts and a
  More button that opens a bottom sheet (Monthly budget, Settings, Logout), so a destructive action
  is never one mis-tap from a tab. Labels are at most 9 characters so five columns fit 320 px. The
  bar is hidden while a text field has focus (on-screen keyboard), and safe-area insets, `dvh`,
  16 px inputs and 48 px touch targets are used. Pages other than Login are placeholders.
- **Rationale**: Matches the product spec's frontend section and keeps the CSRF token out of
  persistent storage.
