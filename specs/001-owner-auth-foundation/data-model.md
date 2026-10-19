# Data Model: Owner-Only Authentication and Application Foundation

All timestamps are `TIMESTAMPTZ`. All primary keys are UUIDs. No monetary fields exist in this
increment. Schema is created by the initial Alembic migration.

## users

Holds the single owner. Matches product spec section 4.2.

| Column | Type | Rules |
|---|---|---|
| `id` | UUID | Primary key, generated |
| `email` | TEXT | Required, unique, normalized: `CHECK (email = lower(btrim(email)))` |
| `password_hash` | TEXT | Required; Argon2id hash, never plaintext |
| `is_active` | BOOLEAN | Default `true` |
| `created_at` | TIMESTAMPTZ | Required, default `now()` |
| `updated_at` | TIMESTAMPTZ | Required, default `now()`, updated on change |

Constraints:

- Unique index on `email`.
- `CREATE UNIQUE INDEX users_single_owner ON users ((true))`: the table can hold at most one row.
- Authority for who may sign in is the `OWNER_EMAIL` setting, not this row: a row whose email
  differs from `OWNER_EMAIL` never authenticates.

## sessions

One row per signed-in browser session.

| Column | Type | Rules |
|---|---|---|
| `id` | UUID | Primary key |
| `user_id` | UUID | Required, FK `users(id)` `ON DELETE CASCADE` |
| `token_hash` | TEXT | Required, unique; SHA-256 hex of the cookie token (raw token never stored) |
| `created_at` | TIMESTAMPTZ | Required |
| `last_seen_at` | TIMESTAMPTZ | Required; refreshed at most once per 5 minutes |
| `expires_at` | TIMESTAMPTZ | Required; `created_at` + absolute lifetime |
| `revoked_at` | TIMESTAMPTZ | Nullable; set on logout or password reset |

Index: `(user_id)` for bulk revocation.

Session validity: `revoked_at IS NULL` AND `now() < expires_at` AND `now() - last_seen_at <
idle timeout` AND the user is active AND the user's email equals `OWNER_EMAIL`.

State transitions: `active` → `revoked` (logout, password reset) or `expired` (time). Expired and
revoked rows are removed opportunistically during login.

## login_attempts

Failed sign-in attempts used for throttling.

| Column | Type | Rules |
|---|---|---|
| `id` | UUID | Primary key |
| `source_ip` | TEXT | Required |
| `email` | TEXT | Required; normalized submitted email (truncated to 320 chars) |
| `attempted_at` | TIMESTAMPTZ | Required, indexed |

Indexes: `(source_ip, attempted_at)`, `(email, attempted_at)`.

Rules:

- A row is inserted only on a failed attempt.
- Source throttle: 5 rows for the same `source_ip` in the last 15 minutes. Account throttle: 20 rows
  for the owner email in the last 15 minutes (the account count uses the configured owner email
  and any attempt targeting it). Limits are configurable.
- A successful login deletes that `source_ip`'s rows.
- Rows older than the window are purged opportunistically.

## Derived (not stored)

- **CSRF token**: `HMAC-SHA256(SECRET_KEY, raw session token)`, hex. Returned in login and
  `/auth/me` response bodies. Never persisted.
- **Owner configuration**: `OWNER_EMAIL` and related settings from the environment (see
  `quickstart.md`).

## Relationships

```text
users 1 ──── * sessions
login_attempts   (standalone; matched by source_ip / email value, no FK)
```

Later increments add `accounts`, `categories`, `transactions` and `monthly_budgets`, all owned by
`users.id`.
