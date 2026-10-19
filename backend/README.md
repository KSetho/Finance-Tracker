# Finance Tracker backend

FastAPI + SQLAlchemy 2 + PostgreSQL. Feature 001 delivers owner-only authentication, sessions, the
administrative owner commands and a health check; feature 002 adds accounts, income and expenses,
transfers with automatic fees, the monthly allowance and the dashboard. Design notes live in
`specs/001-owner-auth-foundation/` and `specs/002-finance-tracking-core/` (OpenAPI contract in
`contracts/finance-api.yaml`).

## Setup

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env               # then edit: OWNER_EMAIL, SECRET_KEY, ...
alembic upgrade head
python -m app.cli provision-owner --email "<your OWNER_EMAIL>"
uvicorn app.main:create_app --factory --reload --port 8000
```

The example configuration uses `sqlite:///./finance.db`, so local development needs no database
server. PostgreSQL is still recommended for production and is required for the full concurrency and
PostgreSQL-specific test suites; switch `DATABASE_URL` to the PostgreSQL example in `.env` when
needed. SQLite enforces foreign keys and uses WAL mode when the application opens it.

`.env` is git-ignored. Generate `SECRET_KEY` with
`python -c "import secrets; print(secrets.token_urlsafe(64))"`.

### Environment variables

| Variable | Required | Notes |
|---|---|---|
| `OWNER_EMAIL` | yes | The only email that may sign in. Validated at startup. |
| `DATABASE_URL` | yes | Local SQLite: `sqlite:///./finance.db`; PostgreSQL URLs are switched to the psycopg 3 driver. |
| `SECRET_KEY` | yes | At least 32 bytes. Used for CSRF tokens. |
| `SESSION_COOKIE_NAME` | no | Default `finance_session`. |
| `APP_ENV` | no | `development` (default), `test` or `production`. Production forces `Secure` cookies, an `https://` `FRONTEND_ORIGIN`, and disables `/docs`. |
| `FRONTEND_ORIGIN` | no | Exact origin allowed to make state-changing requests. Default `http://localhost:5173`. |
| `SESSION_ABSOLUTE_DAYS` / `SESSION_IDLE_HOURS` | no | Defaults 7 days / 24 hours. |
| `LOGIN_MAX_FAILURES_PER_IP` / `LOGIN_MAX_FAILURES_PER_ACCOUNT` | no | Defaults 5 / 20 per 15-minute window. |
| `PASSWORD_RESET_ENABLED` | no | Default `false`; the administrative reset command remains available. |
| `PASSWORD_RESET_EXPIRY_MINUTES` | no | Reset-link lifetime; default 30 minutes. |
| `PASSWORD_RESET_MAX_REQUESTS` / `PASSWORD_RESET_WINDOW_MINUTES` | no | Defaults to 3 reset emails per owner/source in 15 minutes. |
| `EMAIL_PROVIDER` | no | `disabled` (default), `smtp`, or `brevo`. |
| `SMTP_HOST` / `SMTP_PORT` | no | SMTP server; defaults `localhost:25`. |
| `SMTP_USERNAME` / `SMTP_PASSWORD` | for Brevo | Brevo SMTP login and SMTP key—not its API key. |
| `SMTP_FROM_EMAIL` / `SMTP_STARTTLS` / `SMTP_TIMEOUT_SECONDS` | no | Sender and transport settings. Production requires STARTTLS when reset is enabled. |
| `TRUSTED_PROXY` | no | Set `true` only behind a proxy that overwrites `X-Forwarded-For`; otherwise the header is ignored for throttling. |

If `OWNER_EMAIL` or `SECRET_KEY` is missing or invalid the application refuses to start.

## API overview

All routes are under `/api/v1`, need the owner's session, and send/receive money as two-decimal
strings (`"150.00"`). Migrations: run `alembic upgrade head` after pulling; `0002_finance_core` adds
the finance tables and `0003_password_reset_tokens` adds hashed, expiring reset tokens.

| Area | Routes |
|---|---|
| Authentication | `POST /auth/login`, `/auth/forgot-password`, `/auth/reset-password`; `GET /auth/me`; `POST /auth/logout` |
| Accounts | `GET/POST /accounts`, `GET/PATCH /accounts/{id}`, `POST /accounts/{id}/archive` |
| Categories | `GET /categories?type=` |
| Transactions | `GET /transactions` (filters, search, sort, paging), `POST /transactions/income`, `POST /transactions/expenses` (optional fee), `GET/PATCH/DELETE /transactions/{id}` |
| Transfers | `POST /transfers` (optional fee), `GET/PATCH/DELETE /transfers/{id}` |
| Budgets | `GET /budgets`, `GET/PUT /budgets/{year}/{month}` |
| Dashboard | `GET /dashboard/summary`, `/spending-by-category`, `/cash-flow`, `/recent-transactions`, `/calendar?month=YYYY-MM` |

Rules worth knowing: a fee is its own linked expense (counted once, never from the parent's
`fee_amount`); creates accept a client `id` so retries cannot duplicate; edits send the `version`
they read and get `409 stale_version` if it moved; all money arithmetic lives in
`app/services/accounting.py` (a test enforces this).

## Tests

```bash
docker compose up -d db            # integration tests need real PostgreSQL
cd backend && pytest
ruff check . && ruff format --check .
```

The test suite creates a throwaway database on the server in `TEST_DATABASE_URL` (default
`postgresql+psycopg://finance:finance@localhost:5433/finance`), applies the Alembic migrations, and
drops it afterwards.

The ownership tests lift the single-owner index inside the test database only, to create a second
user row; production keeps the index. `python scripts/check_login_timing.py` samples wrong-email and wrong-password sign-ins and checks
that responses are identical and take comparable time.

## Administering the owner account

Run from `backend/` with the target environment loaded (a `.env` file or exported variables).
Passwords are never accepted as arguments; you are prompted twice, or pipe one line with
`--password-stdin`. Minimum length is 7 characters.

```bash
python -m app.cli provision-owner --email "$OWNER_EMAIL"   # once; refuses a second owner
python -m app.cli reset-owner-password                     # forgotten password
```

`reset-owner-password` replaces the password and ends every existing session in one transaction.
It is the fallback when SMTP is unavailable or email reset is disabled. It takes no email, so it
cannot hand the account to another address. Exit codes: `0` success,
`1` refused, `2` configuration/connection error (argparse usage errors also exit `2`).

To run against production, set `DATABASE_URL` (and `OWNER_EMAIL`, `SECRET_KEY`) in your shell to
the production values, run the command from a trusted machine, then close the shell. There is no
public registration endpoint. The public password-reset flow returns the same accepted response for
unknown addresses and mail failures; the administrative command remains available as a fallback.
Reset links are built only from `FRONTEND_ORIGIN`, expire after 30 minutes by default, and are
single-use. Production startup refuses enabled reset unless HTTPS and encrypted SMTP are selected.

### Brevo SMTP

Verify the sender address or domain in Brevo, then create an SMTP key under **Transactional →
Settings → SMTP & API**. Configure:

```dotenv
PASSWORD_RESET_ENABLED=true
EMAIL_PROVIDER=brevo
SMTP_USERNAME=your-brevo-smtp-login
SMTP_PASSWORD=your-brevo-smtp-key
SMTP_FROM_EMAIL=your-verified-sender@example.com
```

The Brevo selector fixes the relay to `smtp-relay.brevo.com:587` with STARTTLS. Do not put the SMTP
key in frontend/Vite variables or commit it to `.env.example`.

## Security notes

- Sessions are server-side. The cookie holds a random token; only its SHA-256 hash is stored.
- State-changing requests need an `Origin`/`Referer` matching `FRONTEND_ORIGIN` and, once signed
  in, an `X-CSRF-Token` header (returned by `POST /auth/login` and `GET /auth/me`).
- Failed sign-ins return one generic error. A wrong email costs the same Argon2 verification as a
  wrong password.
- Password-reset links use a random token while only its SHA-256 hash is stored. Issuing a new link
  invalidates older links; successful reset consumes the link and revokes all sessions atomically.
- Logs record event names and source addresses only, never passwords, tokens or the secret key.
