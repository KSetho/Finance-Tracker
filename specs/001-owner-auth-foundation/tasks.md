---

description: "Task list for Owner-Only Authentication and Application Foundation"
---

# Tasks: Owner-Only Authentication and Application Foundation

**Input**: Design documents from `/specs/001-owner-auth-foundation/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (auth-api.yaml, admin-cli.md), quickstart.md

**Tests**: MANDATORY per the constitution (Principle V). Tests in each phase are written first and MUST fail before the implementation tasks that follow them. Backend integration tests run against real PostgreSQL (`docker compose`).

**Organization**: Tasks are grouped by user story so each story can be implemented and tested independently once the Foundational phase is done.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US4, matching spec.md user stories
- All paths are relative to the repository root

## Path Conventions

- Backend: `backend/app/`, `backend/tests/`, `backend/migrations/`
- Frontend: `frontend/src/`, `frontend/tests/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Repository, tooling and empty project skeletons

- [X] T001 Create root `.gitignore` (ignore `.env`, `.venv/`, `node_modules/`, `__pycache__/`, `dist/`) and `docker-compose.yml` defining a `db` service (PostgreSQL 16, user/password/database `finance`, port 5432, named volume) for local development and tests
- [X] T002 Create backend skeleton: `backend/pyproject.toml` (Python 3.12, Ruff and pytest config), `backend/requirements.txt` (fastapi, uvicorn, sqlalchemy>=2, alembic, psycopg[binary], pydantic>=2, pydantic-settings, argon2-cffi, email-validator, pytest, httpx, ruff), and empty packages with `__init__.py` for every directory under `backend/app/` listed in plan.md plus `backend/tests/`
- [X] T003 [P] Create `backend/.env.example` listing every variable from quickstart.md (`OWNER_EMAIL`, `DATABASE_URL`, `SECRET_KEY`, `SESSION_COOKIE_NAME`, `APP_ENV`, `FRONTEND_ORIGIN`, `SESSION_ABSOLUTE_DAYS`, `SESSION_IDLE_HOURS`, `LOGIN_MAX_FAILURES_PER_IP`, `LOGIN_MAX_FAILURES_PER_ACCOUNT`, `TRUSTED_PROXY`) with placeholder values only
- [X] T004 [P] Scaffold frontend in `frontend/`: `package.json` (react, react-dom, react-router-dom, @tanstack/react-query, react-hook-form, zod, @hookform/resolvers; dev: vite, typescript, vitest, @testing-library/react, @testing-library/user-event, @testing-library/jest-dom, jsdom, msw, eslint), `tsconfig.json`, `index.html`, `vite.config.ts` (dev proxy `/api` to `http://localhost:8000`, Vitest jsdom config), `eslint.config.js`, and `frontend/tests/setup.ts` (jest-dom, MSW server lifecycle)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Configuration, security primitives, database schema, test harness and app factory used by every story

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T005 [P] Write failing tests in `backend/tests/test_config.py`: `normalize_email` trims and lowercases; startup fails when `OWNER_EMAIL` is missing or malformed, when `SECRET_KEY` is under 32 bytes, and when `APP_ENV=production` with a non-HTTPS `FRONTEND_ORIGIN`; defaults for session lifetimes (7 days absolute, 24 h idle) and throttle limits (5 per IP, 20 per account, 15 min window)
- [X] T006 [P] Write failing tests in `backend/tests/test_security.py`: Argon2id hash verifies and differs per call; wrong password fails; `check_needs_rehash` supported; session token is 256-bit random and its SHA-256 hash is deterministic; CSRF token equals HMAC-SHA256 of the session token and changes with `SECRET_KEY`; constant-time comparison helper
- [X] T007 Implement `backend/app/core/config.py`: `Settings` via pydantic-settings with all variables from quickstart.md, `normalize_email()`, validators from T005, cached `get_settings()`; failure at import/startup MUST stop the app rather than allow open access
- [X] T008 [P] Implement `backend/app/core/clock.py`: `Clock` protocol with `now() -> datetime` (UTC, timezone-aware), `SystemClock`, and a FastAPI dependency `get_clock` that tests can override
- [X] T009 Implement `backend/app/core/security.py`: `hash_password`, `verify_password`, `needs_rehash` (argon2-cffi), `DUMMY_HASH` precomputed at import for timing equalization, `new_session_token`, `hash_token` (SHA-256 hex), `csrf_token_for(token, secret)`, `safe_equal`
- [X] T010 [P] Implement `backend/app/core/exceptions.py`: `AppError` base with `status_code`, `code`, `message`; subclasses `InvalidCredentials` (401), `Unauthenticated` (401), `CsrfFailed` (403), `OriginNotAllowed` (403), `TooManyAttempts` (429 with `retry_after`); handlers that render `{"error":{"code","message"}}` for `AppError` and for request validation errors (`422 validation_error`)
- [X] T011 [P] Implement `backend/app/db/base.py` (SQLAlchemy 2.x `DeclarativeBase`, UUID primary-key and `created_at`/`updated_at` TIMESTAMPTZ mixins) and `backend/app/db/session.py` (engine from `DATABASE_URL`, `NullPool` when `APP_ENV=production`, `SessionLocal` factory)
- [X] T012 [P] Implement `backend/app/models/user.py` per data-model.md (`email` text with `CHECK (email = lower(btrim(email)))`, unique; `password_hash`; `is_active`; timestamps)
- [X] T013 [P] Implement `backend/app/models/session.py` per data-model.md (`user_id` FK cascade, unique `token_hash`, `created_at`, `last_seen_at`, `expires_at`, `revoked_at`, index on `user_id`)
- [X] T014 [P] Implement `backend/app/models/login_attempt.py` per data-model.md (`source_ip`, `email`, `attempted_at`; indexes `(source_ip, attempted_at)` and `(email, attempted_at)`) and export all models from `backend/app/models/__init__.py`
- [X] T015 Configure Alembic: `backend/alembic.ini` and `backend/migrations/env.py` (reads `DATABASE_URL` from settings, uses `Base.metadata`)
- [X] T016 Write `backend/tests/conftest.py`: session-scoped fixture that creates a throwaway PostgreSQL database from `DATABASE_URL` host, runs `alembic upgrade head`, and drops it afterwards; per-test cleanup (truncate all tables); `settings` override fixture with a test `OWNER_EMAIL`/`SECRET_KEY`/`FRONTEND_ORIGIN`; controllable fake `Clock`; `client` fixture (FastAPI `TestClient` with DB and clock overrides, default header `Origin: <FRONTEND_ORIGIN>`); `make_owner(email, password, is_active=True)` factory using `hash_password`
- [X] T017 Write failing migration tests in `backend/tests/test_migrations.py`: `alembic upgrade head` creates `users`, `sessions`, `login_attempts`; inserting a second user fails (single-owner index); non-normalized email rejected by the check constraint; duplicate `token_hash` rejected; deleting a user cascades to sessions; `alembic downgrade base` then `upgrade head` succeeds
- [X] T018 Create initial Alembic revision `backend/migrations/versions/0001_initial_auth_schema.py` creating the three tables, the `users_single_owner` unique index on `((true))`, all constraints and indexes from data-model.md; run T017 until it passes
- [X] T019 [P] Implement `backend/app/repositories/user_repository.py` (`get_by_email`, `get_by_id`, `count`, `create`, `update_password_hash`)
- [X] T020 [P] Implement `backend/app/repositories/session_repository.py` (`create`, `get_by_token_hash`, `touch`, `revoke`, `revoke_all_for_user`, `purge_expired`)
- [X] T021 [P] Implement `backend/app/repositories/login_attempt_repository.py` (`add`, `count_for_ip_since`, `count_for_email_since`, `oldest_for_ip_since`, `delete_for_ip`, `purge_before`)
- [X] T022 [P] Implement `backend/app/schemas/auth.py`: `LoginRequest` (email max 320, password 1–1024), `UserOut`, `SessionResponse` (`user`, `csrf_token`, `expires_at`), `ErrorResponse`, matching `contracts/auth-api.yaml`
- [X] T023 Implement `backend/app/dependencies/db.py` (request-scoped session with commit on success and rollback on error) and `backend/app/main.py` app factory: load settings (fail fast), register exception handlers, mount `/api/v1` router, no CORS unless `FRONTEND_ORIGIN` differs from request origin
- [X] T024 Run `ruff check backend` and `pytest backend/tests/test_config.py backend/tests/test_security.py backend/tests/test_migrations.py` against the Docker PostgreSQL; all must pass before starting user stories

**Checkpoint**: Foundation ready; user stories can now begin

---

## Phase 3: User Story 1 - Owner signs in and reaches the protected app (Priority: P1) 🎯 MVP

**Goal**: The owner signs in with the configured email and password and reaches a protected layout that shows who is signed in.

**Independent Test**: Provision the owner (via `make_owner` or the CLI once US4 exists), open the app signed out and confirm only `/login` is reachable, sign in, and confirm the dashboard route loads with the owner's email displayed; reload and stay signed in.

### Tests for User Story 1 (write first, must FAIL before implementation) ⚠️

- [X] T025 [P] [US1] Write failing tests in `backend/tests/test_auth.py`: `POST /api/v1/auth/login` with correct credentials returns 200 with `user`, `csrf_token`, `expires_at`; `Set-Cookie` has `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` equal to the absolute lifetime, and `Secure` when `APP_ENV=production`; email with different case and surrounding spaces succeeds; `GET /api/v1/auth/me` with the cookie returns the same user and a CSRF token; `GET /auth/me` without a cookie returns 401 `unauthenticated`; only a SHA-256 hash of the token is stored in `sessions`
- [X] T026 [P] [US1] Write failing tests in `frontend/tests/login.test.tsx` (MSW): login form validates empty and malformed email and empty password with inline messages; successful submit navigates to `/dashboard`; submit button is disabled and a second click sends no extra request while pending; loading state shown
- [X] T027 [P] [US1] Write failing tests in `frontend/tests/route-guard.test.tsx`: signed-out visit to `/dashboard`, `/transactions`, `/transactions/new`, `/accounts`, `/budget`, `/settings` redirects to `/login`; signed-in visit to `/login` redirects to `/dashboard`; reload with a valid `/auth/me` response keeps the user signed in
- [X] T028 [P] [US1] Write failing tests in `frontend/tests/layout.test.tsx`: protected layout shows the owner email and navigation links Dashboard, Transactions, Accounts, Monthly budget, Settings, Logout; desktop width renders a sidebar and phone width renders bottom navigation; all links are reachable by keyboard

### Implementation for User Story 1

- [X] T029 [US1] Implement login and session validation in `backend/app/services/auth_service.py`: `login(email, password)` normalizes email, requires match with `OWNER_EMAIL`, an existing active owner and a valid password (opportunistic `needs_rehash` upgrade), then creates a session (hash stored, `expires_at` = now + absolute lifetime); `validate_session(token)` returns the owner when the session exists, is not revoked, is not expired and the owner is active with email equal to `OWNER_EMAIL`
- [X] T030 [US1] Implement `backend/app/dependencies/auth.py`: `current_owner` reads the session cookie named by `SESSION_COOKIE_NAME`, calls `validate_session`, raises `Unauthenticated`
- [X] T031 [US1] Implement `POST /auth/login` and `GET /auth/me` in `backend/app/api/auth.py` per `contracts/auth-api.yaml` (cookie attributes from settings, CSRF token via `csrf_token_for`), and include the router in `backend/app/main.py`
- [X] T032 [P] [US1] Create `frontend/src/schemas/auth.ts` (Zod login schema) and `frontend/src/api/client.ts` (fetch wrapper: `credentials: "same-origin"`, JSON in/out, parses `{error:{code,message}}` into an `ApiError`, attaches `X-CSRF-Token` from an in-memory holder on unsafe methods)
- [X] T033 [US1] Create `frontend/src/api/auth.ts` (TanStack Query hooks: `useMe`, `useLogin`) and `frontend/src/auth/AuthProvider.tsx` (holds user and CSRF token in memory only; hydrates from `/auth/me` on load)
- [X] T034 [US1] Create `frontend/src/auth/RequireAuth.tsx` (route guard with loading state) and `frontend/src/pages/LoginPage.tsx` (React Hook Form + Zod, loading and validation states, disabled submit while pending, redirect to `/dashboard` on success and when already signed in, responsive and keyboard accessible)
- [X] T035 [P] [US1] Create `frontend/src/components/Layout.tsx` (desktop sidebar and mobile bottom navigation with Dashboard, Transactions, Accounts, Monthly budget, Settings and Logout; shows owner email) and minimal shared UI in `frontend/src/components/ui/` (Button, TextField, ErrorMessage)
- [X] T036 [P] [US1] Create placeholder pages `frontend/src/pages/DashboardPage.tsx`, `TransactionsPage.tsx`, `NewTransactionPage.tsx`, `AccountsPage.tsx`, `BudgetPage.tsx` and `SettingsPage.tsx` (title and "Coming in a later increment" text; Settings shows the owner email)
- [X] T037 [US1] Wire `frontend/src/App.tsx` and `frontend/src/main.tsx`: QueryClientProvider, AuthProvider, router with `/login` and a `RequireAuth` layout route for `/dashboard`, `/transactions`, `/transactions/new`, `/accounts`, `/budget`, `/settings`, default route redirecting to `/dashboard`
- [X] T038 [US1] Run T025–T028 until they pass; manually verify the story's Independent Test using quickstart.md steps 1–2

**Checkpoint**: User Story 1 is fully functional and testable independently (MVP)

---

## Phase 4: User Story 2 - Everyone else is refused (Priority: P1)

**Goal**: Anyone other than the owner is refused with a generic message, protected data is unreachable without a session, and repeated failures are throttled.

**Independent Test**: Try a different email, the owner email with a wrong password, and no session against every protected route; confirm identical generic refusals and that repeated failures lead to throttling.

### Tests for User Story 2 (write first, must FAIL before implementation) ⚠️

- [X] T039 [P] [US2] Write failing tests in `backend/tests/test_auth_refusal.py`: different email with an existing matching user record, owner email with wrong password, inactive owner, and owner row whose email differs from `OWNER_EMAIL` all return 401 `invalid_credentials` with byte-identical bodies; password verification is invoked exactly once in every path (assert via spy on `verify_password`, dummy hash used when email does not match); oversized email/password and empty fields return 422 without a 500
- [X] T040 [P] [US2] Write failing tests in `backend/tests/test_throttle.py` (fake clock): 5 failures from one IP within 15 minutes cause the 6th attempt to return 429 `too_many_attempts` with `Retry-After`, even with correct credentials; throttled attempts do not run password verification; after the window passes the owner can sign in; a successful login clears that IP's failures; 20 failures from many IPs throttle the account for all sources; a different IP below its own limit is not blocked by another IP's throttle; `X-Forwarded-For` is ignored unless `TRUSTED_PROXY=true`
- [X] T041 [P] [US2] Write failing tests in `backend/tests/test_protected_routes.py`: enumerate `app.routes` under `/api/v1` and assert every route except an explicit public allowlist (`/health`, `/auth/login`) returns 401 without a session; assert no `/auth/register`, `/auth/reset` or `/auth/password*` route exists
- [X] T042 [P] [US2] Extend `frontend/tests/login.test.tsx` with failing cases: 401 shows "Invalid email or password."; 429 shows a "Too many attempts, try again later" message including the retry hint; network/server error shows a generic API error state; form fields keep their values after an error

### Implementation for User Story 2

- [X] T043 [US2] Implement `backend/app/services/throttle_service.py`: `check(ip, email)` raising `TooManyAttempts` with seconds until the oldest counted failure leaves the window; `record_failure(ip, email)`; `clear(ip)`; opportunistic `purge`; limits and window from settings
- [X] T044 [US2] Implement `backend/app/dependencies/client_ip.py`: resolve source IP from the socket peer, or from the platform forwarded header only when `TRUSTED_PROXY=true`
- [X] T045 [US2] Update `login` in `backend/app/services/auth_service.py`: run throttle check first, always perform exactly one password verification (against `DUMMY_HASH` when the email is not the owner's or the owner is missing/inactive), record failures, clear on success, return the identical `InvalidCredentials` error for every failure; pass the client IP from `backend/app/api/auth.py` and add the `Retry-After` header to 429 responses
- [X] T046 [US2] Update `frontend/src/pages/LoginPage.tsx` to render the 401, 429 and generic-error states from T042 using `ApiError.code`, preserving entered values
- [X] T047 [US2] Run T039–T042 until they pass

**Checkpoint**: User Stories 1 and 2 both work independently

---

## Phase 5: User Story 3 - Owner signs out and sessions expire (Priority: P2)

**Goal**: Logout ends access immediately, sessions expire by absolute and idle limits, and state-changing requests from other origins are rejected.

**Independent Test**: Sign in, sign out, and confirm the old session is refused; advance the fake clock past the limits and confirm refusal; send state-changing requests without the correct origin or CSRF token and confirm rejection.

### Tests for User Story 3 (write first, must FAIL before implementation) ⚠️

- [X] T048 [P] [US3] Write failing tests in `backend/tests/test_auth_session.py` (fake clock): logout returns 204, clears the cookie and sets `revoked_at`; replaying the old cookie on `/auth/me` returns 401; a session older than the absolute lifetime is refused; a session idle longer than the idle timeout is refused; `last_seen_at` is refreshed at most once per 5 minutes; revoking one session leaves another valid; expired and revoked rows are purged opportunistically on login
- [X] T049 [P] [US3] Write failing tests in `backend/tests/test_csrf.py`: `POST /auth/logout` without `X-CSRF-Token` returns 403 `csrf_failed`; with a wrong token returns 403; with the token from login succeeds; a request with a foreign `Origin` returns 403 `origin_not_allowed` (including `POST /auth/login`); missing `Origin` falls back to `Referer`, and requests with neither are rejected for unsafe methods; safe methods (`GET`) are not subject to the checks
- [X] T050 [P] [US3] Write failing tests in `frontend/tests/session.test.tsx`: Logout (sidebar, mobile nav and Settings) calls `POST /auth/logout` with the CSRF header and returns to `/login` with the query cache cleared; a 401 from any API call clears auth state and redirects to `/login` with a "Session expired, please sign in again" notice

### Implementation for User Story 3

- [X] T051 [US3] Update `validate_session` in `backend/app/services/auth_service.py` to enforce idle timeout and refresh `last_seen_at` at most every 5 minutes; add `logout(token)` revoking the session; call `purge_expired` opportunistically from `login`
- [X] T052 [US3] Implement `backend/app/dependencies/csrf.py`: `require_csrf` (Origin, falling back to Referer, must equal `FRONTEND_ORIGIN`; `X-CSRF-Token` must equal `csrf_token_for(session token)` using constant-time comparison) and a router-level Origin check applied to every unsafe method including `/auth/login`
- [X] T053 [US3] Implement `POST /auth/logout` in `backend/app/api/auth.py` (requires `current_owner` and `require_csrf`, revokes the session, clears the cookie, returns 204)
- [X] T054 [US3] Update `frontend/src/api/client.ts` and `frontend/src/auth/AuthProvider.tsx`: on any 401 outside the login call clear auth state and redirect to `/login` with the expiry notice; add `useLogout` in `frontend/src/api/auth.ts` and wire Logout in `frontend/src/components/Layout.tsx` and `frontend/src/pages/SettingsPage.tsx`
- [X] T055 [US3] Run T048–T050 until they pass

**Checkpoint**: User Stories 1–3 work independently

---

## Phase 6: User Story 4 - Administrator provisions and manages the owner account (Priority: P2)

**Goal**: The administrator creates the single owner once and can reset the password through documented commands; a health check reports liveness without sensitive data.

**Independent Test**: Run provisioning on an empty database and sign in; run it again and confirm refusal; run the reset and confirm old sessions and the old password stop working; call the health endpoint unauthenticated.

### Tests for User Story 4 (write first, must FAIL before implementation) ⚠️

- [X] T056 [P] [US4] Write failing tests in `backend/tests/test_owner_cli.py`: `provision-owner` creates exactly one owner with an Argon2id hash (no plaintext in DB or output); a second run exits 1 with "An owner already exists."; an email not equal to `OWNER_EMAIL` exits 1; passwords under 7 characters or mismatched prompts exit 1; invalid config exits 2; `reset-owner-password` updates the hash, revokes every session for the owner in the same transaction (old cookie returns 401, old password fails, new password works), exits 1 when no owner exists or the stored email differs from `OWNER_EMAIL`, and accepts no email argument; `--password-stdin` is honored and passwords never appear in output or logs
- [X] T057 [P] [US4] Write failing tests in `backend/tests/test_health.py`: `GET /api/v1/health` without a session returns 200 `{"status":"ok"}` and no other fields; with the database unavailable (engine override that raises) returns 503 `{"status":"unavailable"}`; response and headers expose no version, hostname or configuration

### Implementation for User Story 4

- [X] T058 [US4] Add `provision_owner(email, password)` and `reset_owner_password(password)` to `backend/app/services/auth_service.py` per `contracts/admin-cli.md` (rules: email equals `OWNER_EMAIL`, no existing user, password ≥ 7 chars; reset updates hash and revokes all sessions in one transaction)
- [X] T059 [US4] Implement `backend/app/cli.py` (`python -m app.cli provision-owner --email ... [--password-stdin]` and `reset-owner-password [--password-stdin]`) using `getpass` with confirmation prompt, exit codes 0/1/2 from `contracts/admin-cli.md`, never accepting passwords as arguments and never printing them
- [X] T060 [P] [US4] Implement `GET /health` in `backend/app/api/health.py` (trivial DB round-trip, 200 `{"status":"ok"}` or 503 `{"status":"unavailable"}`, no authentication) and include the router in `backend/app/main.py`
- [X] T061 [US4] Run T056–T057 until they pass; manually run `provision-owner` against the Docker database and sign in through the UI (quickstart.md steps 3–5)

**Checkpoint**: All four user stories are independently functional

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, hardening and end-to-end validation across stories

- [X] T062 [P] Write `backend/README.md`: setup, environment variables, running migrations, tests, the administrative provision and password-reset procedure (including running against the production database), and the security notes from research.md
- [X] T063 [P] Add Python logging configuration in `backend/app/core/` that never logs passwords, tokens or the CSRF token, plus a test in `backend/tests/test_auth.py` asserting none of these values appear in captured logs during login, failure, logout and CLI runs
- [X] T064 Verify no secrets in the repository or browser bundle (SC-007): search tracked files and `frontend/dist` for `SECRET_KEY`, `DATABASE_URL`, passwords and tokens; confirm `.env` is git-ignored and only `.env.example` is committed
- [X] T065 [P] Sample 100 wrong-email and 100 wrong-password sign-ins with a throwaway script in `backend/scripts/check_login_timing.py` and confirm identical bodies and comparable timing (SC-004); record the result in the PR description
- [X] T066 Manually verify responsive behavior and keyboard-only operation of the login screen and layout at phone and desktop widths (SC-009) and record findings in `specs/001-owner-auth-foundation/checklists/requirements.md` notes
- [X] T067 Run the full suites (`ruff check backend`, `pytest` in `backend/`, `npm run lint` and `npm test` in `frontend/`) and walk through `quickstart.md` end to end on a clean database, timing the setup (SC-008)

---

## Phase 8: Mobile-first pass (added 2026-10-17)

**Purpose**: The owner uses a phone most. The first implementation was desktop-first with an
11px, six-item bottom bar; this phase fixes that. See `checklists/requirements.md` for the audit.

- [X] T068 Audit the shell at 320, 360, 375, 414 px and landscape; record findings (clipped and sub-12px tab labels, Logout inside the tab bar, no thumb-reach Add action, no safe-area/`dvh`/keyboard handling, desktop-first CSS)
- [X] T069 Rewrite `frontend/src/index.css` mobile-first: phone base styles with `min-width: 768px` for the sidebar, 48px controls with 16px text, safe-area insets, `dvh`, `touch-action: manipulation`, hover styles only under `(hover: hover)`, landscape-phone slimming, reduced-motion
- [X] T070 Update `frontend/index.html` (`viewport-fit=cover`, `theme-color`, `color-scheme`)
- [X] T071 Rebuild `frontend/src/components/Layout.tsx`: phone tab bar (Home, History, Add, Accounts, More) with icons from `frontend/src/components/icons.tsx`, More sheet (Monthly budget, Settings, Logout) with focus management, Escape/backdrop close and Tab trap; desktop sidebar gains an Add transaction action
- [X] T072 [P] Add `frontend/src/hooks/useKeyboardOpen.ts` and hide the tab bar while a text field has focus
- [X] T073 [P] Add `frontend/src/components/ui/PasswordField.tsx` (Show/Hide) and phone input attributes on the login form (`inputMode`, `autoCapitalize`, `autoCorrect`, `spellCheck`, `enterKeyHint`)
- [X] T074 Update and add tests in `frontend/tests/layout.test.tsx`, `session.test.tsx`, `login.test.tsx`, `useKeyboardOpen.test.tsx`; re-run the browser audit at all widths

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; start immediately
- **Foundational (Phase 2)**: Depends on Setup; BLOCKS all user stories
- **User Stories (Phases 3–6)**: All depend on Foundational completion
- **Polish (Phase 7)**: Depends on the stories being complete

### User Story Dependencies

- **US1 (P1)**: After Foundational; no dependency on other stories (uses the `make_owner` test factory to create an owner)
- **US2 (P1)**: After Foundational; modifies `login` from US1 (T045 follows T029), so run after US1 on the shared `auth_service.py`/`api/auth.py` files; its tests are independent
- **US3 (P2)**: After Foundational; modifies `validate_session` from US1 and `api/auth.py` (follows T031); frontend changes follow T033–T035
- **US4 (P2)**: After Foundational; only adds new functions to `auth_service.py` and new files, so can proceed in parallel with US2/US3 on a different branch of the file, but merge order matters for `auth_service.py`

### Within Each Story

- Tests MUST be written and FAIL before implementation
- Models and repositories (Foundational) before services; services before endpoints; backend before the frontend pieces that call it
- Story complete (checkpoint) before moving to the next priority

### Parallel Opportunities

- Setup: T003 and T004 in parallel
- Foundational: T005/T006 together; T008, T010, T011 together; T012–T014 together; T019–T022 together
- US1 tests T025–T028 together; T032, T035, T036 together
- US2 tests T039–T042 together
- US3 tests T048–T050 together
- US4 tests T056–T057 together; T060 in parallel with T058–T059
- Polish: T062, T063, T065 together

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task: "Write failing tests in backend/tests/test_auth.py (login + me)"
Task: "Write failing tests in frontend/tests/login.test.tsx"
Task: "Write failing tests in frontend/tests/route-guard.test.tsx"
Task: "Write failing tests in frontend/tests/layout.test.tsx"

# Launch independent frontend building blocks together:
Task: "Create frontend/src/schemas/auth.ts and frontend/src/api/client.ts"
Task: "Create frontend/src/components/Layout.tsx and ui/ components"
Task: "Create placeholder pages in frontend/src/pages/"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (critical; blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: sign in with an owner created by test factory or direct database insert
5. Do not deploy: US2 (refusal and throttling) is also P1 and required before the app is exposed publicly

### Incremental Delivery

1. Setup + Foundational: foundation ready
2. Add US1 (sign in), then US2 (refusals and throttling): minimum safe slice, fulfills both P1 stories
3. Add US3 (logout, expiry, CSRF): complete session lifecycle
4. Add US4 (provisioning, reset, health): operable in production
5. Polish, then proceed to increment 002 (accounts)

### Notes

- Constitution gates: Principle IV (security) and V (test-first on PostgreSQL) apply to every task above
- Commit after each task or logical group
- The Vercel entry point and deployment configuration are intentionally out of scope (increment 008)
- Avoid: skipping a failing test by weakening it; running backend tests against SQLite
