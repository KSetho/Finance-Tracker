# Research: Finance Tracking Core

The stack is fixed by the constitution and increment 001 (FastAPI, SQLAlchemy 2.x, Alembic,
PostgreSQL, React/TypeScript/Vite, TanStack Query, React Hook Form + Zod, Recharts). This document
settles the design questions that remain for roadmap increments 002–007. No `NEEDS CLARIFICATION`
items remain.

## R1. Transaction storage model

- **Decision**: One `transactions` table with `type` (`income`, `expense`, `transfer`) exactly as the
  product specification defines. `account_id` is the account receiving (income), paying (expense) or
  sending (transfer); `destination_account_id` is used only by transfers. A fee is a separate
  `expense` row whose `related_transaction_id` points at its parent. The parent keeps `fee_amount`
  as the input value only.
- **Rationale**: A fee must be a real expense (counted, categorised as Fees, dated, charged to an
  account) so every report uses the same rule: spent = sum of expense rows. The parent's
  `fee_amount` is never summed, which makes double counting structurally impossible.
- **Alternatives considered**: Separate `transaction_fees` table (extra joins in every report); fee
  as a column only (cannot be charged to a different account or categorised).

## R2. Database-enforced invariants

- **Decision**: Enforce as much as PostgreSQL can, in addition to service validation:
  - `CHECK (amount > 0)` and `CHECK (fee_amount >= 0)`.
  - Per-type shape checks: income and expense need `account_id` and no destination; a transfer needs
    both, and `account_id <> destination_account_id`; only transfers may have a destination.
  - Unique partial index on `related_transaction_id` (at most one linked fee per parent).
  - A fee row must be an expense with `fee_amount = 0` and a parent; `related_transaction_id` is a
    foreign key with `ON DELETE CASCADE`, so deleting a parent can never leave a dangling fee.
  - Composite foreign keys `(account_id, user_id)` and `(category_id, user_id)` to accounts and
    categories, so a transaction can only reference rows of the same owner.
- **Rationale**: Constitution Principle III. These guard against bugs in the service layer and
  against concurrent requests.
- **Alternatives considered**: Application-only validation (races, bugs go unnoticed).

## R3. Balances are derived, in one place

- **Decision**: No stored balance. A single SQL expression in `services/accounting.py` computes
  `opening_balance + income - expenses - transfers_out + transfers_in` per account. The same module
  provides period totals (income, expenses, fees), spending by category, and the cash-flow series.
  Account, budget, dashboard and history endpoints call these functions and nothing else does
  arithmetic on money.
- **Rationale**: Constitution Principles I and II (one accounting implementation, derived balances).
  At one owner's volume (about 1,500 rows a year) aggregate queries are far below the 2-second goal.
- **Alternatives considered**: Cached balance columns (risk of drift, needs reconciliation);
  materialised views (unneeded).

## R4. Exact money in Python, JSON and the browser

- **Decision**: `NUMERIC(14,2)` columns, `Decimal` in Python, and a shared Pydantic `Money` type that
  accepts only JSON strings or numbers with at most two decimals, rejects values over 12 integer
  digits, and always serialises as a fixed two-decimal string (`"150.00"`). The frontend never adds
  or compares money as floats: it validates input with a regular expression, sends the string, and
  displays strings the server returns using `Intl.NumberFormat` on the string value. Numbers are
  converted to floats only to position chart marks, never to produce a displayed figure.
- **Rationale**: Constitution Principle I and FR-034.
- **Alternatives considered**: Integer pesewas (clear but diverges from the specified `NUMERIC`
  schema and API); a JS decimal library (extra dependency; the frontend does no arithmetic).

## R5. Idempotent creates (duplicate taps and retries)

- **Decision**: Create requests (accounts, income, expenses, transfers) accept an optional
  client-generated UUID `id`. The form generates one when it opens and reuses it for every retry of
  that form. The server inserts with that primary key; on a conflict it returns the existing record
  with `200` if the key fields are identical and `409 id_conflict` if not. Fee rows get a
  deterministic id derived from the parent id.
- **Rationale**: Satisfies FR-031 and SC-011 without an idempotency-key table. The primary key is the
  uniqueness guarantee, enforced by the database, so it holds under concurrent double submits.
- **Alternatives considered**: `Idempotency-Key` header with stored responses (more state and
  cleanup); relying on disabling the button (does not survive network retries or two tabs).

## R6. Concurrent edits

- **Decision**: Balances are derived, so concurrent writes cannot lose updates. Editing a
  transaction uses optimistic concurrency: rows carry an integer `version` that the client sends back
  on `PATCH`; the server increments it and returns `409 stale_version` on mismatch. Within the
  request the parent row (and any linked fee) is locked with `SELECT ... FOR UPDATE` so the
  parent-and-fee update is serialised.
- **Rationale**: Spec edge case "later save wins, earlier device is told the entry changed".
- **Alternatives considered**: Last-write-wins silently (hides conflicts); pessimistic edit locks
  (too heavy for one user).

## R7. Archived accounts and opening dates

- **Decision**: Archived accounts keep full history and are excluded from the combined balance and
  from pickers. Creating or editing an entry may only reference an archived account if the edit does
  not change that reference. Every involved account (including the fee account) must have
  `opening_date <= transaction_date`. Changing an account's opening date or balance is validated
  against its earliest activity. Accounts are never deleted.
- **Rationale**: Spec edge cases and FR-003/FR-004/FR-012.
- **Alternatives considered**: Forbid editing anything on archived accounts (blocks fixing history).

## R8. Categories

- **Decision**: Categories are seeded per owner (defaults from FR-009) when the owner is provisioned
  and by the migration for an already-provisioned owner. `(user_id, category_type, name)` is unique.
  Only built-in categories exist for now, so there is no create/edit endpoint, only
  `GET /categories?type=`. A category's type must match the transaction type (income categories on
  income, expense categories on expenses and fees); income may omit it.
- **Rationale**: Smallest scope that meets FR-009; custom categories are out of scope.
- **Alternatives considered**: Custom category CRUD now (not required, slows delivery).

## R9. Monthly allowance model

- **Decision**: `monthly_budgets(user_id, month_start DATE, allowance NUMERIC(14,2) >= 0)`, unique on
  `(user_id, month_start)`; `PUT /budgets/{year}/{month}` is an upsert (naturally idempotent). The
  summary for a month joins the allowance (nullable when unset) with `accounting` period totals.
  Percentage used is `(spent / allowance) * 100` to two decimals when the allowance is greater than
  zero, otherwise `null` ("N/A"). `GET /budgets?from=&to=` lists months (default last 12) with
  allowance, spent, remaining and percentage for comparison (FR-021).
- **Rationale**: Product spec sections 4.6 and 5.5.

## R10. Dates and the Ghana time zone

- **Decision**: Transaction dates are PostgreSQL `DATE`, month ranges are calendar-month
  `[first day, first day of next month)`. "Today" and "current month" defaults come from
  `Africa/Accra` using `zoneinfo`, on the server for API defaults and through
  `Intl.DateTimeFormat` with `timeZone: "Africa/Accra"` on the device for form defaults.
- **Rationale**: Constitution Principle VII and FR-032. The owner's device may be set to another
  time zone; the date logic must not depend on it.
- **Alternatives considered**: Device-local dates (wrong month boundaries when travelling).

## R11. API shape

- **Decision**: Follow product specification section 5 with these additions: `GET /categories`,
  `GET /budgets` (list), embedded `fee` on transfer and payment responses, a `q` search filter,
  `fee_account_id` on payment (`POST /transactions/expenses`) and transfer bodies, and `page_size`
  default 20 (max 100). Fee rows appear in lists with `is_fee: true`; `PATCH`/`DELETE` on a fee row
  returns `409 fee_managed_by_parent`. A transaction's type cannot be changed by `PATCH`. Ownership
  failures return `404`, not `403`, so IDs are not probed. Errors keep the 001 envelope.
- **Rationale**: Matches the written spec; additions are what the screens need.

## R12. Reports and charts

- **Decision**: Spending by category is a SQL `GROUP BY category` over expense rows only (fees fall
  under Fees; transfers excluded), with each category's share computed server-side. Cash flow groups
  by day for ranges up to 31 days and by month beyond that, filling empty buckets with zero. The
  summary endpoint returns everything the dashboard top section needs in one call; charts use their
  own endpoints so they can be filtered independently.
- **Rationale**: FR-022–FR-025; fewer round trips on a phone connection.

## R13. Frontend structure and data flow

- **Decision**: TanStack Query per resource with a shared `queryKeys` module; every successful
  mutation invalidates the affected keys (accounts, transactions, budgets, dashboard) so figures
  refresh only after the API confirms. Routes: `/dashboard`, `/transactions`, `/transactions/new`,
  `/transactions/:id`, `/accounts`, `/accounts/new`, `/accounts/:id/edit`, `/budget`, `/settings`.
  Create/edit screens are full-screen routes, not modals, because that is the most reliable pattern
  with an on-screen keyboard. Filters on History open a bottom sheet on phones. Forms use React Hook
  Form + Zod with amount as a string, native `<select>` and `<input type="date">` (best mobile
  pickers), numeric keypad via `inputMode="decimal"`. The last-used account id is remembered in
  `localStorage`.
- **Rationale**: Mobile-first requirement (FR-029/FR-030); native controls give the best phone UX.
- **Alternatives considered**: Custom dropdowns and date pickers (worse on phones, more code).

## R14. Charts for phones

- **Decision**: Recharts inside `ResponsiveContainer`. Spending by category is a horizontal bar chart
  (long category names fit) with a plain list of name, amount and share beneath, so nothing depends
  on hover. Cash flow is a grouped bar chart of income vs expenses with a compact legend and a
  summary row of totals. Charts have a fixed height, `aria-label`s and tables/lists as text
  alternatives; colours also differ in pattern or label, not colour alone.
- **Rationale**: SC-008 (readable without hovering, no horizontal scroll at 320 px).

## R15. Testing approach

- **Decision**: Backend: pytest on real PostgreSQL. One test module per area plus
  `test_accounting_invariants.py` (a seeded random sequence of operations after which balances,
  period totals and history sums must reconcile), `test_concurrency.py` (threads for duplicate
  creates and conflicting edits) and `test_ownership.py` (a second user row created by temporarily
  dropping the single-owner index inside the test database). Frontend: Vitest + RTL + MSW for money
  formatting, forms, list filters, dashboard states, and the add flow; plus a reusable in-browser
  mobile audit script run at 320, 360, 375, 414 px and landscape.
- **Rationale**: Constitution Principle V; the mobile audit makes the owner's top requirement
  repeatable instead of a one-off check.

## R16. Delivery order (speed without losing safety)

- **Decision**: Build in vertical slices, each ending in a checkpoint with passing tests and a
  working screen, in dependency order: S1 accounts, S2 categories + income/expenses + history, S3
  transfers and fees, S4 allowance, S5 dashboard, S6 polish and audit. Backend and frontend of a slice
  are built together; the shared accounting module and constraints land in S1/S2 so later slices only
  add to them.
- **Rationale**: The owner asked for speed; slices keep the app usable after every step and keep the
  riskiest rule (transfers and fees) tested before reports depend on it.
