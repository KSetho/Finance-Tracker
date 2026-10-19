# Data Model: Finance Tracking Core

All primary keys are UUIDs, all money is `NUMERIC(14,2)`, effective dates are `DATE`, audit times
are `TIMESTAMPTZ`. Everything is owned by `users.id` (the single owner from increment 001). Created
by Alembic revision `0002_finance_core`.

## accounts

| Column | Type | Rules |
|---|---|---|
| `id` | UUID | PK; client may supply it (idempotent create) |
| `user_id` | UUID | FK `users(id)`, required |
| `name` | VARCHAR(80) | Required, trimmed, non-empty |
| `account_type` | ENUM `account_type` | `bank`, `mobile_money`, `cash` |
| `opening_balance` | NUMERIC(14,2) | `>= 0`, default 0 |
| `opening_date` | DATE | Required |
| `is_archived` | BOOLEAN | Default false |
| `created_at`, `updated_at` | TIMESTAMPTZ | Required |

Constraints: `UNIQUE (id, user_id)` (target of composite foreign keys), `CHECK (opening_balance >= 0)`,
unique `(user_id, lower(name))` among all accounts (a name stays reserved after archiving so history
is never ambiguous).

**Current balance** (derived, never stored):

```text
balance(a) = opening_balance
           + SUM(amount) FILTER (type = 'income'   AND account_id = a)
           - SUM(amount) FILTER (type = 'expense'  AND account_id = a)   -- includes fee rows
           - SUM(amount) FILTER (type = 'transfer' AND account_id = a)
           + SUM(amount) FILTER (type = 'transfer' AND destination_account_id = a)
```

Combined balance = sum of `balance` over accounts where `is_archived = false`.

## categories

| Column | Type | Rules |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | UUID | FK `users(id)` |
| `name` | VARCHAR(60) | Required |
| `category_type` | ENUM `category_type` | `income`, `expense` |
| `is_system` | BOOLEAN | True for built-ins |
| `created_at` | TIMESTAMPTZ | Required |

Constraints: `UNIQUE (id, user_id)`, `UNIQUE (user_id, category_type, name)`.

Seeded per owner: income Salary, Freelance, Business, Gift, Other income; expense Food, Transport,
Bills, Shopping, Health, Family, Fees, Other expense. Seeding happens in `provision_owner` and in the
migration for an already-provisioned owner (idempotent).

## transactions

| Column | Type | Rules |
|---|---|---|
| `id` | UUID | PK; client may supply for parents (idempotent create) |
| `user_id` | UUID | FK `users(id)` |
| `type` | ENUM `transaction_type` | `income`, `expense`, `transfer` |
| `name` | VARCHAR(120) | Required, trimmed |
| `description` | TEXT | Nullable, max 500 characters (checked in the schema) |
| `amount` | NUMERIC(14,2) | `> 0`, principal |
| `transaction_date` | DATE | Effective date |
| `account_id` | UUID | Receiving (income), paying (expense), sending (transfer) account |
| `destination_account_id` | UUID | Transfers only |
| `category_id` | UUID | Nullable (income may omit; expenses require one, enforced in the service) |
| `fee_amount` | NUMERIC(14,2) | `>= 0`, default 0; input value on a parent, never summed |
| `related_transaction_id` | UUID | Set on a linked fee expense: the parent |
| `version` | INTEGER | Starts at 1, `+1` on every edit (optimistic concurrency) |
| `created_at`, `updated_at` | TIMESTAMPTZ | Required |

Constraints (all enforced by PostgreSQL):

- `CHECK (amount > 0)`, `CHECK (fee_amount >= 0)`.
- `CHECK` per type:
  - `income`/`expense`: `account_id IS NOT NULL AND destination_account_id IS NULL`.
  - `transfer`: `account_id IS NOT NULL AND destination_account_id IS NOT NULL AND account_id <> destination_account_id`.
- Fee rows: `CHECK (related_transaction_id IS NULL OR (type = 'expense' AND fee_amount = 0))`.
- `FOREIGN KEY (related_transaction_id) REFERENCES transactions(id) ON DELETE CASCADE`.
- `UNIQUE INDEX ON (related_transaction_id) WHERE related_transaction_id IS NOT NULL`: at most one
  linked fee per parent.
- Composite FKs: `(account_id, user_id)` and `(destination_account_id, user_id)` to
  `accounts(id, user_id)`; `(category_id, user_id)` to `categories(id, user_id)`.
- Indexes: `(user_id, transaction_date DESC, created_at DESC)`, `(user_id, type, transaction_date)`,
  `(account_id)`, `(destination_account_id)`, `(category_id)`.

Service-level rules (cannot be expressed as simple row checks):

- Every involved account (source, destination, fee account) is active unless the edit leaves an
  existing reference unchanged, and has `opening_date <= transaction_date`.
- Category type matches the transaction type; expenses require a category; fee rows use `Fees`.
- Type is immutable after creation; a fee row is never edited or deleted directly.
- Expense or transfer with `fee_amount > 0` always has exactly one linked fee row; with `0` has none.

### The fee, step by step

Parent `P` (transfer or expense) with `fee_amount = f > 0` and `fee_account_id = x`:

| Operation | Effect in one DB transaction |
|---|---|
| Create | Insert `P`; insert fee row `F` (`type=expense`, `amount=f`, `category=Fees`, `account_id=x`, `transaction_date=P.date`, `name="Fee: " + P.name`, `related=P.id`, `id=uuid5(P.id, "fee")`). |
| Edit (fee `f→f'`, `f'>0`) | Update `P`; update `F` amount/account/date/name to match. |
| Edit (`f→0`) | Update `P`; delete `F`. |
| Edit (`0→f'>0`) | Update `P`; insert `F`. |
| Delete | Delete `P`; `F` is removed (explicitly and by `ON DELETE CASCADE`). |

Expenses counted for any period = `SUM(amount)` over `type = 'expense'` rows, which includes `F`
once and never reads `P.fee_amount`.

## monthly_budgets

| Column | Type | Rules |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | UUID | FK `users(id)` |
| `month_start` | DATE | First day of the month (`CHECK (EXTRACT(day FROM month_start) = 1)`) |
| `allowance` | NUMERIC(14,2) | `>= 0` |
| `created_at`, `updated_at` | TIMESTAMPTZ | Required |

Constraint: `UNIQUE (user_id, month_start)`.

## Derived figures (not stored)

For a period `[start, end)` and owner:

```text
E  expenses      = SUM(amount) WHERE type='expense'
F  fees          = SUM(amount) WHERE type='expense' AND related_transaction_id IS NOT NULL   (subset of E)
I  income        = SUM(amount) WHERE type='income'
net cash flow    = I - E
remaining        = allowance - E                       (may be negative)
percentage used  = round(E / allowance * 100, 2)       (null when allowance is 0 or unset)
spending by category = SUM(amount) WHERE type='expense' GROUP BY category
```

Transfers (`type='transfer'`) and opening balances appear in none of these.

## Relationships

```text
users 1 ── * accounts
users 1 ── * categories
users 1 ── * transactions
users 1 ── * monthly_budgets
accounts 1 ── * transactions (as account_id)
accounts 1 ── * transactions (as destination_account_id, transfers only)
categories 1 ── * transactions
transactions 1 ── 0..1 transactions (linked fee, via related_transaction_id)
```

## Migration notes

- `0002_finance_core` creates enums, the four tables, constraints and indexes, then seeds default
  categories for any existing owner.
- Downgrade drops the tables and enums in reverse order.
- Tested on real PostgreSQL: upgrade, constraint behaviour, downgrade/upgrade round trip.
