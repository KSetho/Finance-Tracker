# Implementation Plan: Owner-Only Authentication and Application Foundation

**Branch**: `001-owner-auth-foundation` | **Date**: 2026-10-17 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-owner-auth-foundation/spec.md`

## Summary

Deliver the secure application skeleton: a FastAPI backend with PostgreSQL, Alembic migrations and
owner-only authentication (server-side sessions in secure HTTP-only cookies, Argon2id passwords,
CSRF protection, database-backed login throttling, administrative provisioning and password-reset
CLI, health endpoint), plus a React/TypeScript frontend shell with a login screen, route
protection and placeholder pages. Design choices are in [research.md](research.md); schema in
[data-model.md](data-model.md); interfaces in [contracts/](contracts/).

## Technical Context

**Language/Version**: Python 3.12 (backend); TypeScript 5.x on Node.js 20+ (frontend)  
**Primary Dependencies**: FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2 + pydantic-settings, psycopg 3, argon2-cffi, uvicorn; React 18, Vite, React Router, TanStack Query, React Hook Form, Zod  
**Storage**: PostgreSQL (tables: `users`, `sessions`, `login_attempts`)  
**Testing**: pytest + FastAPI TestClient against real PostgreSQL (docker compose); Vitest + React Testing Library + MSW; Ruff and ESLint  
**Target Platform**: Linux serverless/web hosting (Vercel + Supabase in increment 008); modern desktop and mobile browsers  
**Project Type**: Web application (backend + frontend)  
**Performance Goals**: Sign-in completes within 1 s at the server on typical hardware; authenticated `/auth/me` p95 under 200 ms; login screen to dashboard in under 15 s (SC-001)  
**Constraints**: Cookies `HttpOnly` + `Secure` (production) + `SameSite=Lax`; same-origin `/api` routing; no secrets in source or frontend bundle; state must live in the database (no in-memory sessions or counters, serverless-safe); sign-in failures indistinguishable in content and timing  
**Scale/Scope**: One owner; a handful of concurrent sessions; 3 tables; 4 endpoints; 7 frontend routes (6 placeholders)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. Exact money**: Not exercised; no monetary fields in this increment. Foundation sets up
      Decimal-safe tooling (no float usage introduced).
- [x] **II. Ledger integrity**: Not applicable; no transactions or balances yet.
- [x] **III. Atomicity**: Password reset updates the hash and revokes sessions in one transaction;
      single-owner rule is enforced by a database unique index on a constant expression.
- [x] **IV. Owner-only security**: `OWNER_EMAIL` authority, Argon2id, secure HTTP-only cookie,
      CSRF (Origin + HMAC token), login rate limiting with generic errors, auth required on all
      non-health endpoints, no secrets in repo (`.env.example` only), exact-origin CORS/Origin checks.
- [x] **V. Test-first on PostgreSQL**: Tests precede implementation; integration tests run on real
      PostgreSQL with Alembic-applied schema; injectable clock for expiry and throttle tests.
- [x] **VI. Layering**: Routes in `api/`, rules in `services/`, persistence in `repositories/`;
      schema delivered by Alembic migration.
- [x] **VII. Dates & simplicity**: `TIMESTAMPTZ` for all timestamps; scope limited to FR-01 and the
      skeleton. Redis/async/JWT rejected as unnecessary (see research R1, R13).

**Post-design re-check (after Phase 1)**: all gates still pass. No violations; Complexity Tracking
is empty. Two tables beyond the product spec's `users` (`sessions`, `login_attempts`) are required
by FR-008/FR-011/FR-014 on a stateless-hosting platform and are not a deviation from the
constitution.

## Project Structure

### Documentation (this feature)

```text
specs/001-owner-auth-foundation/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── auth-api.yaml    # OpenAPI for health and auth endpoints
│   └── admin-cli.md     # provision-owner / reset-owner-password
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
docker-compose.yml               # local PostgreSQL (host port 5433)
.gitignore                       # excludes .env, .venv, node_modules

backend/
├── app/
│   ├── main.py                  # app factory, routers, middleware, startup config validation
│   ├── cli.py                   # provision-owner, reset-owner-password
│   ├── core/
│   │   ├── config.py            # Settings (OWNER_EMAIL, SECRET_KEY, ...), email normalization
│   │   ├── security.py          # Argon2id hashing, token generation/hashing, CSRF HMAC
│   │   ├── exceptions.py        # AppError types and JSON error handlers
│   │   ├── clock.py             # injectable time source
│   │   └── logging.py           # app logger setup; events only, never credentials
│   ├── api/
│   │   ├── auth.py              # /auth/login, /auth/logout, /auth/me
│   │   └── health.py            # /health
│   ├── dependencies/
│   │   ├── db.py                # request-scoped session (services own commits)
│   │   ├── settings.py          # settings and clock from app.state
│   │   ├── auth.py              # current_owner (session validation)
│   │   ├── client_ip.py         # source IP for throttling (proxy header only if trusted)
│   │   └── csrf.py              # Origin + X-CSRF-Token enforcement
│   ├── models/
│   │   ├── user.py
│   │   ├── session.py
│   │   └── login_attempt.py
│   ├── schemas/
│   │   └── auth.py              # LoginRequest, SessionResponse, ErrorResponse
│   ├── services/
│   │   ├── auth_service.py      # login, logout, session validation, owner provisioning/reset
│   │   └── throttle_service.py  # attempt recording and window checks
│   ├── repositories/
│   │   ├── user_repository.py
│   │   ├── session_repository.py
│   │   └── login_attempt_repository.py
│   └── db/
│       ├── base.py
│       └── session.py
├── scripts/
│   └── check_login_timing.py    # SC-004 sampling script
├── migrations/                  # Alembic; initial revision: users, sessions, login_attempts
├── tests/
│   ├── conftest.py              # PostgreSQL test DB, migrations, clock, client fixtures
│   ├── test_auth.py             # login/logout/me, wrong email vs password, inactive, sessions
│   ├── test_throttle.py         # per-IP and per-account limits, window expiry
│   ├── test_csrf.py             # Origin and token enforcement
│   ├── test_owner_cli.py        # provision and reset behavior, session revocation
│   ├── test_health.py
│   ├── test_config.py           # startup validation, email normalization
│   ├── test_security.py         # hashing, tokens, CSRF HMAC
│   ├── test_migrations.py       # schema constraints on real PostgreSQL
│   ├── test_auth_refusal.py     # identical refusals, one verification per path
│   ├── test_auth_session.py     # logout, absolute/idle expiry, purge
│   └── test_protected_routes.py # every non-public route returns 401
├── alembic.ini
├── requirements.txt
├── pyproject.toml
├── .env.example
└── README.md                    # run, test, admin reset procedure

frontend/
├── src/
│   ├── main.tsx
│   ├── App.tsx                  # router + providers
│   ├── api/
│   │   ├── client.ts            # fetch wrapper: credentials, CSRF header, 401 handling
│   │   └── auth.ts              # login, logout, me hooks (TanStack Query)
│   ├── auth/
│   │   ├── AuthProvider.tsx     # holds user + CSRF token in memory
│   │   └── RequireAuth.tsx      # route guard
│   ├── components/
│   │   ├── Layout.tsx           # desktop sidebar; phone tab bar + More sheet
│   │   ├── icons.tsx            # inline SVG icons for the tab bar
│   │   └── ui/                  # Button, TextField, PasswordField (show/hide), ErrorMessage
│   ├── hooks/
│   │   └── useKeyboardOpen.ts   # hides the tab bar while a text field is focused
│   ├── pages/
│   │   ├── LoginPage.tsx
│   │   ├── DashboardPage.tsx    # placeholder
│   │   ├── TransactionsPage.tsx # placeholder
│   │   ├── NewTransactionPage.tsx # placeholder
│   │   ├── AccountsPage.tsx     # placeholder
│   │   ├── BudgetPage.tsx       # placeholder
│   │   └── SettingsPage.tsx     # logout, shows owner email
│   └── schemas/
│       └── auth.ts              # Zod login schema
├── tests/
│   ├── login.test.tsx
│   ├── route-guard.test.tsx
│   └── layout.test.tsx
├── index.html
├── vite.config.ts               # dev proxy /api -> http://localhost:8000
├── package.json
└── tsconfig.json
```

**Structure Decision**: Web application with `backend/` and `frontend/` at the repository root.
The backend follows the layout mandated by the constitution (Principle VI) and the product
specification section 8; `auth_service.py` and `throttle_service.py` are added to `services/`.
Vercel entry points and `vercel.json` are deferred to increment 008 (deployment).

## Complexity Tracking

No constitution violations. Table intentionally empty.
