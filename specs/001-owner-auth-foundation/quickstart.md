# Quickstart: Owner-Only Authentication and Application Foundation

Target: a working owner sign-in on a fresh machine in under 30 minutes (SC-008). These steps
describe the layout the implementation will produce; they become runnable as tasks complete.

## Prerequisites

- Python 3.12, Node.js 20+, Docker (for local PostgreSQL)

## 1. Start PostgreSQL

```bash
docker compose up -d db
```

## 2. Configure the backend

Create `backend/.env` (never committed; `.env.example` lists every key):

| Variable | Example | Notes |
|---|---|---|
| `OWNER_EMAIL` | `you@example.com` | Required; the only email that may sign in |
| `DATABASE_URL` | `postgresql+psycopg://finance:finance@localhost:5433/finance` | Required |
| `SECRET_KEY` | 64+ random characters | Required; at least 32 bytes. Generate with `python -c "import secrets; print(secrets.token_urlsafe(64))"` |
| `SESSION_COOKIE_NAME` | `finance_session` | Default shown |
| `APP_ENV` | `development` | `production` forces `Secure` cookies and HTTPS origin |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | Exact origin for Origin/CORS checks |
| `SESSION_ABSOLUTE_DAYS` | `7` | Optional |
| `SESSION_IDLE_HOURS` | `24` | Optional |
| `LOGIN_MAX_FAILURES_PER_IP` | `5` | Optional, 15-minute window |
| `LOGIN_MAX_FAILURES_PER_ACCOUNT` | `20` | Optional, 15-minute window |
| `TRUSTED_PROXY` | `false` | Set `true` only behind the hosting platform's proxy |

## 3. Install, migrate, provision

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
python -m app.cli provision-owner --email "$OWNER_EMAIL"
```

The command prompts for a password (7+ characters).

## 4. Run the backend and frontend

```bash
uvicorn app.main:create_app --factory --reload --port 8000
```

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api` to `http://localhost:8000`, so the browser sees one origin.

## 5. Verify

1. Open `http://localhost:5173/dashboard`: you are redirected to `/login`.
2. Sign in with the owner email and password: you land on the dashboard and see your email.
3. Sign in with any other email: generic "Invalid email or password."
4. `curl -s http://localhost:8000/api/v1/health` returns `{"status":"ok"}`.
5. Click Logout: you return to `/login`; the old session no longer works.

## 6. Run the tests

```bash
cd backend && pytest        # needs the PostgreSQL container from step 1
cd frontend && npm test
```

## Administrative password reset

```bash
cd backend
python -m app.cli reset-owner-password
```

Ends all existing sessions. Details in `contracts/admin-cli.md`.
