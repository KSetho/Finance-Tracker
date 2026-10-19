---

description: "Task list for Finance Tracking Core"
---

# Tasks: Finance Tracking Core

**Input**: Design documents from `/specs/002-finance-tracking-core/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (finance-api.yaml, ui-screens.md), quickstart.md. Builds on the 001 code in `backend/` and `frontend/`.

**Tests**: MANDATORY (constitution Principle V). In every phase the test tasks come first, are written first and MUST fail before the implementation tasks after them. Backend integration tests run on real PostgreSQL (`docker compose up -d db`, port 5433).

**Mobile-first (standing owner requirement)**: every frontend task is designed at 320–414 px first. Each user-story phase ends with a mobile audit task that runs `frontend/scripts/mobile-audit.js` at 320, 360, 375, 414 px and 667×375 landscape.

**Organization**: Tasks are grouped by user story. Phase order follows the delivery slices in plan.md (S1 US1, S2 US2 + US6, S3 US3, S4 US4, S5 US5, S6 polish), not strict priority order, because the History screen (US6) is where entries from US2 are seen and corrected.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US6, matching spec.md user stories
- All paths are relative to the repository root. Backend commands run from `backend/` with the venv (`.venv/bin/...`).

## Conventions every task follows

- Money is `Decimal` in the backend and a two-decimal string in JSON; never `float` (constitution I).
- Only `backend/app/services/accounting.py` sums money; services call it, never re-implement it (constitution II).
- Services own transaction boundaries (`db.commit()` once at the end of a use case; failures roll back everything).
- New routers are registered in `backend/app/main.py` under the existing `/api/v1` router (Origin/CSRF dependency already applies).
- Resources not owned by the signed-in owner return `404 not_found`.
- Frontend money is never added or compared as numbers; it is validated by regex and formatted from server strings.

---

## Phase 1: Setup

**Purpose**: Dependencies and tooling used by every slice

- [X] T001 Add Recharts to the frontend: run `npm install recharts` in `frontend/` and commit the updated `frontend/package.json` and `frontend/package-lock.json`
- [X] T002 [P] Create `frontend/scripts/mobile-audit.js`: a self-contained script to paste in the browser console that, for the current page, returns JSON with `vw`, `scrollW` (horizontal overflow when `scrollWidth > innerWidth`), visible `a/button/input/select/textarea` smaller than 44 px (name, width, height), visible leaf text under 12 px, bottom-nav labels clipped (`scrollWidth > clientWidth`), and chart containers wider than the viewport

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, money type, dates, error codes, shared UI and fixtures used by every story

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Tests first

- [X] T003 [P] Write failing tests in `backend/tests/test_money_rules.py`: the `Money` type accepts `"150"`, `"150.5"`, `150.25` and `"0.00"`; rejects three decimals, more than 12 integer digits, non-numeric strings, `NaN`/`Infinity`, and the float artifact `0.30000000000000004`; a `gt=0` variant rejects zero and negatives; serialization is always a fixed two-decimal string (`"150.00"`, `"-200.00"`); the model never produces `float`
- [X] T004 [P] Write failing tests in `backend/tests/test_dates.py`: `accra_today(clock)` returns the Ghana-time date for an aware UTC clock; `parse_month("2026-10")` returns `date(2026, 10, 1)`; malformed months (`"2026-13"`, `"26-1"`, `""`) raise a validation error; `month_range(date(2026, 12, 1))` is `[2026-12-01, 2027-01-01)`; `month_of(date)` and `format_month(date)` round trip
- [X] T005 [P] Write failing tests in `backend/tests/test_finance_migration.py` against the real test database: tables `accounts`, `categories`, `transactions`, `monthly_budgets` and the three enums exist; each CHECK rejects its bad row (amount `<= 0`, negative `fee_amount`, income or expense with a destination, transfer without a destination, transfer with identical source and destination, fee row that is not an expense or has a nonzero `fee_amount`, budget `month_start` not on the 1st, negative allowance, negative opening balance); the unique partial index rejects a second fee for one parent; deleting a parent cascades to its fee; composite foreign keys reject another owner's account or category (use the `allow_second_user` fixture); duplicate account name differing only by case is rejected; duplicate `(user_id, category_type, name)` rejected; `(user_id, month_start)` unique; upgrading from `0001` with an owner already present seeds the 13 default categories exactly once; downgrade then upgrade round-trips
- [X] T006 [P] Write failing tests in `frontend/tests/money.test.ts`: `formatGhs("1234.5")` is `GH₵ 1,234.50`, `formatGhs("-200")` shows a minus sign, `formatGhs("0.10")` is `GH₵ 0.10`, `formatGhs("999999999999.99")` keeps every digit; `isValidAmountInput` accepts `"1"`, `"1."`-style rejected, `"1.5"`, `"1.50"`, `"0.01"` and rejects `""`, `"abc"`, `"1.234"`, `"-5"`, `"1e3"`, 13 integer digits; `normalizeAmount("150.5")` is `"150.50"`
- [X] T007 [P] Write failing tests in `frontend/tests/dates.test.ts`: `formatDate("2026-10-07")` is `07 Oct 2026`; `accraToday(new Date("2026-10-31T23:30:00Z"))` returns `2026-10-31`; `currentMonth(date)` returns `2026-10`; `shiftMonth("2026-12", 1)` is `2027-01`, `shiftMonth("2026-01", -1)` is `2025-12`; `monthLabel("2026-10")` is `October 2026`
- [X] T008 [P] Write failing tests in `frontend/tests/ui-components.test.tsx`: `MoneyField` renders `inputMode="decimal"`, 16 px text class, rejects letters as typed and shows an error message; `Select` is a native `<select>` with label; `DateField` is a native `type="date"`; `Segmented` is a `radiogroup` operable by arrow keys; `ConfirmDialog` traps focus, closes on Escape, calls `onConfirm` once even when the button is clicked twice; `Sheet` focuses its first control, closes on Escape and backdrop; `EmptyState` shows its action; `Skeleton` is hidden from assistive tech with a status label on the wrapper; `useIdempotentId` returns a stable UUID until `reset()` is called; `useLastAccount` reads and writes `localStorage`

### Backend foundation

- [X] T009 [P] Create SQLAlchemy models per data-model.md: `backend/app/models/account.py` (`Account`, enum `AccountType`), `backend/app/models/category.py` (`Category`, enum `CategoryType`), `backend/app/models/transaction.py` (`Transaction`, enum `TransactionType`, all CHECKs, composite FKs, partial unique index, indexes, `version`), `backend/app/models/budget.py` (`MonthlyBudget`); export them from `backend/app/models/__init__.py`
- [X] T010 Write Alembic revision `backend/migrations/versions/0002_finance_core.py` creating the enums, the four tables, every constraint and index in data-model.md (including `UNIQUE (id, user_id)` targets, case-insensitive unique account name index, partial unique index on `related_transaction_id`, `ON DELETE CASCADE` on `related_transaction_id`), then seeding the default categories for an existing owner (idempotent); downgrade drops everything in reverse; run `alembic upgrade head` and make `test_finance_migration.py` pass
- [X] T011 [P] Implement `backend/app/schemas/common.py`: `Money` (Decimal validated to at most two places and 12 integer digits, rejects float artifacts, serialized as a fixed two-decimal string), `PositiveMoney`, `NonNegativeMoney`, `Month` helpers, `Page` query params (`page >= 1`, `page_size` 1–100 default 20)
- [X] T012 [P] Implement `backend/app/core/dates.py`: `accra_today(clock)`, `parse_month`, `month_range`, `month_of`, `format_month`, using `zoneinfo.ZoneInfo("Africa/Accra")`
- [X] T013 [P] Extend `backend/app/core/exceptions.py` with `NotFound` (404 `not_found`), `IdConflict` (409 `id_conflict`), `StaleVersion` (409 `stale_version`), `FeeManagedByParent` (409 `fee_managed_by_parent`), `TypeImmutable` (409 `type_immutable`), and a `BusinessRuleError(code, message)` (422) used for `account_archived`, `before_opening_date`, `same_account`, `category_type_mismatch`, `activity_before_opening_date`; handlers already render the shared `{"error": {...}}` envelope
- [X] T014 [P] Implement `backend/app/services/category_service.py` first part: `DEFAULT_CATEGORIES` (income: Salary, Freelance, Business, Gift, Other income; expense: Food, Transport, Bills, Shopping, Health, Family, Fees, Other expense) and idempotent `seed_defaults(db, user_id)`; add `backend/app/repositories/category_repository.py` with `list`, `get_owned`, `get_fees_category`, `insert_missing`
- [X] T015 Update `provision_owner` in `backend/app/services/auth_service.py` to seed the default categories in the same transaction as the owner, and extend `backend/tests/test_owner_cli.py` to assert 13 categories exist after provisioning and that re-running seeding adds none
- [X] T016 Extend `backend/tests/conftest.py`: add the four new tables to the `TRUNCATE` in `clean_db`; make `make_owner` seed default categories; add `make_account(db, user, name, account_type, opening_balance, opening_date)` and a `worked_example` fixture creating Bank 2,000.00, MoMo 300.00, Cash 0.00 (opening 2026-10-01); add `allow_second_user` (drops index `users_single_owner` for the test and recreates it after truncating)
- [X] T017 Run `ruff check`, `ruff format --check` and `pytest tests/test_money_rules.py tests/test_dates.py tests/test_finance_migration.py tests/test_owner_cli.py` and make them pass

### Frontend foundation

- [X] T018 [P] Implement `frontend/src/lib/money.ts` (`MONEY_INPUT_REGEX`, `isValidAmountInput`, `normalizeAmount`, `formatGhs` using `Intl.NumberFormat` on the string, no arithmetic) and `frontend/src/lib/dates.ts` (`formatDate`, `accraToday`, `currentMonth`, `shiftMonth`, `monthLabel`, using `Intl.DateTimeFormat` with `timeZone: "Africa/Accra"`)
- [X] T019 [P] Create shared form and layout components in `frontend/src/components/ui/`: `MoneyField.tsx`, `Select.tsx`, `DateField.tsx`, `Segmented.tsx`, `Sheet.tsx` (bottom sheet reusing the More-sheet behaviour), `ConfirmDialog.tsx`, `EmptyState.tsx`, `Skeleton.tsx`; 48 px controls, 16 px text, labels tied to inputs, error text linked with `aria-describedby`; add the needed rules to `frontend/src/index.css` mobile-first
- [X] T020 [P] Create `frontend/src/api/queryKeys.ts` (keys for accounts, categories, transactions list/detail, budgets, dashboard parts, plus an `invalidateFinance(queryClient)` helper that invalidates accounts, transactions, budgets and dashboard) and `frontend/src/hooks/useIdempotentId.ts` and `frontend/src/hooks/useLastAccount.ts`
- [X] T021 Run `npm run lint`, `npm run typecheck` and `npm test -- money dates ui-components` in `frontend/` and make the foundational frontend tests pass

**Checkpoint**: Schema migrated, money/date/error primitives and shared UI ready; user stories can begin

---

## Phase 3: User Story 1 - Set up accounts with opening balances (Priority: P1) 🎯 Slice S1

**Goal**: The owner creates bank, mobile money and cash accounts with opening balances, sees each balance and the combined total, renames/corrects them and archives them.

**Independent Test**: Create Bank GH₵2,000.00, MoMo GH₵300.00 and Cash GH₵0.00; the combined balance is GH₵2,300.00; archive one and it leaves the total and the pickers but its record remains.

### Tests for User Story 1 (write first, must FAIL before implementation) ⚠️

- [X] T022 [P] [US1] Write failing tests in `backend/tests/test_accounts.py`: create returns 201 with `balance == opening_balance` and creates no transaction row; list returns items plus `combined_balance` of active accounts only (`include_archived` shows archived but never counts them); rename; edit opening balance and date recalculates the balance; blank name, 81-character name, negative or 3-decimal opening balance, bad type and bad date return 422; duplicate name (any case) returns 422; creating twice with the same client `id` and fields returns 200 with the same account, and with different fields returns 409 `id_conflict`; archive keeps the row and its history; `GET /accounts/{id}` of a missing id returns 404; all routes return 401 without a session
- [X] T023 [P] [US1] Write failing tests in `frontend/tests/accounts.test.tsx` (MSW): list shows each account with type, `formatGhs` balance and the combined total; loading skeleton, empty state ("Add your first account") and request-error banner with retry; "New account" form validates name, type, amount (`1.234`, `-5`, blank defaults to 0.00) and date, shows field errors, and reuses one client `id` across a double tap (one request); archive asks for confirmation (extra warning when the balance is not zero) and the account leaves the list; edit page prefills values

### Implementation for User Story 1

- [X] T024 [P] [US1] Create `backend/app/schemas/account.py`: `AccountCreate` (optional `id`, `name` trimmed 1–80, `account_type`, `opening_balance` non-negative default `0.00`, `opening_date`), `AccountUpdate` (all optional), `AccountOut` (includes derived `balance`), `AccountList` (`items`, `combined_balance`) per `contracts/finance-api.yaml`
- [X] T025 [P] [US1] Create `backend/app/repositories/account_repository.py`: `list_for_user(include_archived)`, `get_owned(db, user_id, id, for_update=False)`, `insert`, `name_exists(db, user_id, name, exclude_id)` (case-insensitive), `earliest_activity_date(db, account_id)` (min `transaction_date` over rows where the account is source or destination; `None` when no activity)
- [X] T026 [US1] Create `backend/app/services/accounting.py`: `account_balances(db, user_id, account_ids=None) -> dict[UUID, Decimal]` using one SQL expression exactly as data-model.md (opening balance plus income, minus expense rows including fees, minus transfers out, plus transfers in) and `combined_balance(db, user_id)` over active accounts; this file is the only place allowed to sum money
- [X] T027 [US1] Create `backend/app/services/account_service.py`: `create` (idempotent by `id`: same fields return existing, different fields raise `IdConflict`), `list`, `get` (404 when not owned), `update` (name uniqueness; refuse an opening date later than the earliest activity with `activity_before_opening_date`), `archive`; commit once per operation
- [X] T028 [US1] Create `backend/app/api/accounts.py` (`GET/POST /accounts`, `GET/PATCH /accounts/{id}`, `POST /accounts/{id}/archive`) using `current_owner`, and register it in `backend/app/main.py`; run `tests/test_accounts.py` and `tests/test_protected_routes.py` until they pass
- [X] T029 [P] [US1] Create `frontend/src/api/accounts.ts` (TanStack Query hooks `useAccounts`, `useAccount`, `useCreateAccount` with `useIdempotentId`, `useUpdateAccount`, `useArchiveAccount`; mutations call `invalidateFinance` on success only) and `frontend/src/schemas/account.ts` (Zod: trimmed name 1–80, type, amount regex, date)
- [X] T030 [P] [US1] Create `frontend/src/components/AccountCard.tsx` (name, type label and icon, balance with negative state shown as text, archived badge) and `frontend/src/components/StatCard.tsx` (label, value, optional hint) used by accounts and later by the dashboard
- [X] T031 [US1] Replace the placeholder in `frontend/src/pages/AccountsPage.tsx`: combined balance card, account cards, "Show archived" toggle, "New account" button reachable by thumb, loading/empty/error states
- [X] T032 [US1] Create `frontend/src/pages/AccountFormPage.tsx` for `/accounts/new` and `/accounts/:id/edit`: name, type (Segmented), opening balance (`MoneyField`), opening date (`DateField`, default today in Accra), sticky Save, Archive section on edit with `ConfirmDialog`; register the routes in `frontend/src/App.tsx`
- [X] T033 [US1] Run US1 tests (`pytest tests/test_accounts.py`, `npm test -- accounts`), then start the app, sign in, run `frontend/scripts/mobile-audit.js` on `/accounts`, `/accounts/new` and the More sheet at 320, 360, 375, 414 px and 667×375, and fix every finding

**Checkpoint**: Accounts work end to end on a phone (slice S1 done)

---

## Phase 4: User Story 2 - Record income and expenses quickly (Priority: P1) Slice S2

**Goal**: The owner records and edits income and expenses from a fast phone form; balances update when the API confirms.

**Independent Test**: With an account at GH₵1,000, record GH₵500 income then a GH₵100 expense; balance is GH₵1,400 and both entries show.

### Tests for User Story 2 (write first, must FAIL before implementation) ⚠️

- [X] T034 [P] [US2] Write failing tests in `backend/tests/test_transactions.py`: income of 500.00 raises the account balance and appears in income; expense of 100.00 lowers it and appears in expenses; an expense above the balance is accepted and the balance is negative; income categories only for income (an expense category returns 422 `category_type_mismatch`), expense requires a category; amount `0`, `-1`, `1.234`, missing name, blank name, bad date, unknown account return 422/404; account archived returns 422 `account_archived`; transaction date before the account's opening date returns 422 `before_opening_date`; foreign or missing account id returns 404; same client `id` retry returns 200 with one row, different fields 409 `id_conflict`; `GET /transactions/{id}`; `PATCH` changes name, description, date, amount, account and category and rebalances both accounts, bumps `version`, rejects a wrong `version` with 409 `stale_version`, rejects changing type with 409 `type_immutable` (`type` in body), and only checks archived rules for changed account references; `DELETE` returns 204 and restores the balance; transactions in an archived account may still be edited when the account is unchanged
- [X] T035 [P] [US2] Write failing tests in `frontend/tests/add-transaction.test.tsx` (MSW): the Add screen opens on Expense with the amount field focused, `inputMode="decimal"`, date prefilled with today in Accra and the last-used account preselected from `localStorage`; Income shows income categories (optional) and Expense shows expense categories (required); name defaults to the category name when blank; invalid amount (`0`, `1.234`) and missing required fields show field errors without sending a request; double tap on Save sends one request and both attempts carry the same `id`; success returns to History and invalidates accounts, transactions, budgets and dashboard queries; request error keeps the form values and shows a retry banner; Save shows "Saving…" and is disabled while pending

### Implementation for User Story 2

- [X] T036 [P] [US2] Create `backend/app/schemas/category.py` (`CategoryOut`) and `backend/app/schemas/transaction.py` with `IncomeCreate`, `ExpenseCreate`, `TransactionUpdate` (partial, `version` required, reject `type`), and `TransactionOut` (account refs, category, `fee_amount`, `fee`, `is_fee`, `related_transaction_id`, `version`, timestamps) per `contracts/finance-api.yaml`; fee fields are accepted but ignored until US3 wires them
- [X] T037 [P] [US2] Create `backend/app/repositories/transaction_repository.py`: `insert`, `get_owned(db, user_id, id, for_update=False)` with accounts and category loaded, `update_fields`, `delete`, `get_fee_for_parent`; extend `backend/app/repositories/category_repository.py` as needed
- [X] T038 [US2] Extend `backend/app/services/category_service.py` with `list(db, user_id, type)` and `require_category(db, user_id, category_id, expected_type)` (404 when not owned, 422 `category_type_mismatch`)
- [X] T039 [US2] Create `backend/app/services/transaction_service.py` with shared helpers `validate_accounts(db, user_id, account_ids, on_date, changed_ids)` (owned, active unless unchanged, `opening_date <= date`) and `check_version`; implement `create_income`, `create_expense` (idempotent by `id`), `get`, `update` (income and expense: lock the row with `FOR UPDATE`, version check, type immutable, revalidate changed fields, increment `version`, commit once) and `delete`
- [X] T040 [P] [US2] Create `backend/app/api/categories.py` (`GET /categories?type=`)
- [X] T041 [US2] Create `backend/app/api/transactions.py` (`POST /transactions/income`, `POST /transactions/expenses`, `GET /transactions/{id}`, `PATCH /transactions/{id}`, `DELETE /transactions/{id}`; `201` on create, `200` on idempotent retry) and register both new routers in `backend/app/main.py`; run `tests/test_transactions.py` and `tests/test_protected_routes.py` until they pass
- [X] T042 [P] [US2] Create `frontend/src/api/categories.ts` and `frontend/src/api/transactions.ts` (create income/expense hooks using `useIdempotentId`, `useTransaction`, update and delete hooks; on success `invalidateFinance` and `useLastAccount().remember`) and `frontend/src/schemas/transaction.ts` (Zod income and expense schemas with the amount regex)
- [X] T043 [US2] Create `frontend/src/components/TransactionForm.tsx`: one form used for create and edit of income and expense (amount first and focused, account `Select`, category `Select`, `DateField`, name, collapsed "Add details" for description), sticky Save above the keyboard safe area, field-level errors, request-error banner, pending state
- [X] T044 [US2] Replace `frontend/src/pages/NewTransactionPage.tsx` with the Add screen: `Segmented` Expense | Income (Transfer is added in US3), uses `TransactionForm`, success navigates to `/transactions` with a confirmation message; the bottom-bar Add tab and desktop button already point here
- [X] T045 [US2] Run US2 tests (`pytest tests/test_transactions.py`, `npm test -- add-transaction`), then in the browser add an expense, add an income and edit one, run `frontend/scripts/mobile-audit.js` on `/transactions/new` at all five viewport sizes (including with the on-screen keyboard emulated: focus a field and confirm the tab bar hides and Save stays visible) and fix every finding

**Checkpoint**: Entries can be created, edited and deleted via the API and the Add screen (slice S2 part 1)

---

## Phase 5: User Story 6 - Browse, filter, edit and delete history (Priority: P2) Slice S2

**Goal**: The owner browses all transactions, searches and filters them, and opens any entry to edit or delete it.

**Independent Test**: Record entries across two months, filter by category and date range, edit one amount and one date, delete one with confirmation; balances and monthly figures follow.

### Tests for User Story 6 (write first, must FAIL before implementation) ⚠️

- [X] T046 [P] [US6] Write failing tests in `backend/tests/test_transaction_list.py`: default order newest first (ties by creation time); `start_date`/`end_date` inclusive; `type`, `category_id`, `account_id` (matches source or destination), `q` (case-insensitive name search) filters and their combinations; `sort_by=amount` with `sort_order=asc|desc`; `page`/`page_size` with correct `total`; `page_size` over 100 and bad dates return 422; empty result returns `items: []`; the item shape includes account names and category; 401 without a session
- [X] T047 [P] [US6] Write failing tests in `frontend/tests/history.test.tsx` (MSW): rows show type sign and colour-independent label, name, `DD MMM YYYY`, account and `formatGhs` amount; skeleton, empty state ("No transactions yet" with Add action; "No matches" with Clear filters) and error banner with retry; search box debounces and filters; the filter sheet applies date range, type, category and account, shows removable active-filter chips, and Clear resets; "Load more" appends the next page; tapping a row opens `/transactions/:id`
- [X] T048 [P] [US6] Write failing tests in `frontend/tests/transaction-detail.test.tsx` (MSW): detail shows all fields; Edit opens the prefilled form and saves with the current `version`; a `409 stale_version` response shows "This entry changed on another device" with a Reload action; Delete opens `ConfirmDialog`, confirming once calls delete once and returns to History; unknown id shows a not-found state

### Implementation for User Story 6

- [X] T049 [US6] Extend `backend/app/repositories/transaction_repository.py` with `list_page(db, user_id, filters, sort, page, page_size)` and `count(db, user_id, filters)` (filters: dates, type, category, account either side, name `ILIKE`), selecting accounts and category in one query, using the indexes from data-model.md
- [X] T050 [US6] Add `list` to `backend/app/services/transaction_service.py` and `GET /transactions` (with `Page` params, `sort_by` of `transaction_date|amount`, `sort_order`) to `backend/app/api/transactions.py`; return `{items, page, page_size, total}`; run `tests/test_transaction_list.py` until it passes
- [X] T051 [P] [US6] Extend `frontend/src/api/transactions.ts` with `useTransactionList(filters)` (infinite query for "Load more") and filter serialisation helpers
- [X] T052 [P] [US6] Create `frontend/src/components/TransactionRow.tsx` (type label and sign, name, date, account, amount; transfer and fee presentation is completed in US3)
- [X] T053 [US6] Replace `frontend/src/pages/TransactionsPage.tsx`: search field, "Filters" button opening a `Sheet` (date range, type, category, account, sort), active-filter chips, grouped list with date headings optional, "Load more", loading/empty/error states
- [X] T054 [US6] Create `frontend/src/pages/TransactionDetailPage.tsx` at `/transactions/:id`: read view, Edit (reuses `TransactionForm` with `version`), Delete with `ConfirmDialog`, `stale_version` handling with Reload; register the route in `frontend/src/App.tsx`
- [X] T055 [US6] Run US6 tests (`pytest tests/test_transaction_list.py`, `npm test -- history transaction-detail`), then in the browser verify editing a date across months and deleting an entry change balances, and run `frontend/scripts/mobile-audit.js` on `/transactions`, the filter sheet and `/transactions/:id` at all five viewport sizes and fix every finding

**Checkpoint**: Entries are findable and correctable (slice S2 done)

---

## Phase 6: User Story 3 - Move money between accounts and record fees (Priority: P1) Slice S3

**Goal**: Transfers move money once, fees become exactly one linked expense, payments to other people carry optional fees, and edits and deletes keep everything consistent.

**Independent Test**: Bank 2,000 / MoMo 300 / Cash 0: transfer 500 Bank→MoMo, withdraw 500 MoMo→Cash with a 5 fee charged to MoMo; balances 1,500 / 295 / 500, income 0, expenses 5, total funds 2,295.

### Tests for User Story 3 (write first, must FAIL before implementation) ⚠️

- [X] T056 [P] [US3] Write failing tests in `backend/tests/test_transfers.py` using `worked_example`: transfer 500.00 with no fee moves principal once and leaves income and expenses unchanged; the full worked example ends at Bank 1500.00, MoMo 295.00, Cash 500.00, combined 2295.00, income 0.00, expenses 5.00; fee charged to the destination account and to the source account both deduct from the chosen account; a fee creates exactly one linked expense (`is_fee`, category Fees, same date, `related_transaction_id`, name `Fee: …`) and `fee_amount 0` creates none; same source and destination returns 422 `same_account`; archived account returns 422 `account_archived`; date before an account's opening date returns 422 `before_opening_date`; fee account that is neither source nor destination returns 422; editing amount, accounts, date and fee together updates both balances and the fee; fee `5 → 0` deletes the fee row, `0 → 5` creates it; changing the date moves the fee with it; deleting the transfer removes the fee and restores balances; wrong `version` returns 409 `stale_version`; retry with the same `id` returns 200 and creates one transfer and one fee; the fee row's id is deterministic from the parent id
- [X] T057 [P] [US3] Write failing tests in `backend/tests/test_fees.py`: expense of 100.00 with `fee_amount 2.00` creates two expense rows and lowers the account by 102.00, expenses rise by 102.00 and the parent's `fee_amount` is not added again; `fee_account_id` charges a different account; editing the expense's fee and amount keeps the pair in sync; deleting the expense removes its fee; `PATCH` and `DELETE` on a fee row return 409 `fee_managed_by_parent`; `GET` of a fee row works and shows `is_fee`; **rollback**: with the fee insert forced to raise (monkeypatch the repository), no parent, no fee and no balance change remains for create, edit and delete; the database refuses a second fee for the same parent even by direct insert; concurrent creates with the same `id` leave exactly one parent and one fee
- [X] T058 [P] [US3] Write failing tests in `frontend/tests/transfer-form.test.tsx` (MSW): Transfer tab on the Add screen shows amount, From, To, date, name and a collapsed "Add a fee" (amount and "Charged to" choice of From or To); From and To cannot be the same; archived accounts are not offered; submitting sends `source_account_id`, `destination_account_id`, `fee_amount`, `fee_account_id` and one client `id` even on a double tap; Expense tab has "Sent to someone else? Add a fee" that sends `fee_amount` and `fee_account_id` on the expense; validation and server errors are shown without losing values
- [X] T059 [P] [US3] Write failing tests in `frontend/tests/fees-ui.test.tsx` (MSW): History shows a fee row labelled "Fee for <parent name>" and a transfer row with a neutral transfer label (not income or expense colour semantics); the detail page for a transfer shows Principal and Fee on separate lines and edits through the transfers endpoint; the detail page of a fee row explains it is managed by its transfer and offers a link to the parent, with no Edit or Delete

### Implementation for User Story 3

- [X] T060 [P] [US3] Create `backend/app/schemas/transfer.py` (`TransferCreate`, `TransferUpdate`) and extend `backend/app/schemas/transaction.py`: `ExpenseCreate` and `TransactionUpdate` accept `fee_amount` and `fee_account_id`; `TransactionOut` includes `fee` (`id`, `amount`, `account`) for a parent
- [X] T061 [US3] Implement shared fee logic in `backend/app/services/transfer_service.py`: `sync_fee(db, parent, fee_amount, fee_account_id)` that creates, updates or deletes the single linked fee row (`uuid5(parent.id, "fee")` id, category Fees, `expense`, parent's date, name `Fee: <parent name>`), validates the fee account (owned, active unless unchanged, opening date, and for transfers source or destination), and never touches `fee_amount` sums; all callers pass the same session so everything commits together
- [X] T062 [US3] Implement `create_transfer`, `update_transfer` and `delete_transfer` in `backend/app/services/transfer_service.py`: validate accounts (differ, owned, active unless unchanged, opening dates), idempotent by `id`, row locks with `FOR UPDATE` on the parent and its fee, version check, `sync_fee`, one commit; any exception rolls back everything
- [X] T063 [US3] Wire fees into `backend/app/services/transaction_service.py`: `create_expense` and `update` call `sync_fee` for expenses (payment to another person); `delete` removes parent and fee; `update` and `delete` on a fee row raise `FeeManagedByParent`; `get` returns the parent with its `fee`
- [X] T064 [US3] Create `backend/app/api/transfers.py` (`POST /transfers`, `GET/PATCH/DELETE /transfers/{id}`, 404 for non-transfers) and register it in `backend/app/main.py`; make `PATCH /transactions/{id}` and `DELETE /transactions/{id}` handle transfers by delegating to the transfer service; run `tests/test_transfers.py`, `tests/test_fees.py`, `tests/test_transactions.py` until they pass
- [X] T065 [P] [US3] Create `frontend/src/api/transfers.ts` (create, update, delete hooks with `useIdempotentId`, invalidation) and `frontend/src/schemas/transfer.ts` (Zod: accounts differ, optional fee with amount regex and charged account)
- [X] T066 [P] [US3] Create `frontend/src/components/FeeFields.tsx` (collapsible "Add a fee" section: fee amount and "Charged to" as a two-option Segmented control) and `frontend/src/components/TransferForm.tsx`; add a "Sent to someone else? Add a fee" use of `FeeFields` inside `TransactionForm.tsx` for expenses
- [X] T067 [US3] Add the Transfer segment to `frontend/src/pages/NewTransactionPage.tsx`; extend `frontend/src/components/TransactionRow.tsx` and `frontend/src/pages/TransactionDetailPage.tsx` to show transfers (neutral label, from → to) with principal and fee on separate lines, label fee rows "Fee for <parent>" with a link to the parent and no edit or delete, and edit or delete transfers through the transfers hooks
- [X] T068 [US3] Run US3 tests (`pytest tests/test_transfers.py tests/test_fees.py`, `npm test -- transfer-form fees-ui`), walk through steps 1–4 and 8–11 of `quickstart.md` in the browser (worked example numbers must match exactly), run `frontend/scripts/mobile-audit.js` on the Transfer tab, the fee section and a transfer detail at all five viewport sizes and fix every finding

**Checkpoint**: All P1 stories complete: a usable tracker with correct money movement (slice S3 done, MVP)

---

## Phase 7: User Story 4 - Set a monthly spending allowance (Priority: P2) Slice S4

**Goal**: The owner sets a per-month allowance and sees spent, remaining and percentage used, including overspending.

**Independent Test**: Allowance GH₵3,000 for October, GH₵1,200 spent: remaining GH₵1,800.00, 40.00% used; spending GH₵2,000 more shows -GH₵200.00 and over budget.

### Tests for User Story 4 (write first, must FAIL before implementation) ⚠️

- [X] T069 [P] [US4] Write failing tests in `backend/tests/test_budgets.py`: allowance 3000.00 with 1200.00 spent returns `remaining 1800.00` and `percentage_used "40.00"`; further spending beyond the allowance gives a negative `remaining`, `is_over_budget true` and no error; fee expenses count once and transfer principals never count; no allowance returns `allowance null`, `remaining null`, `percentage_used null` while `total_expenses` is still reported; allowance `0.00` returns `percentage_used null`; negative or 3-decimal allowance returns 422; `PUT` twice upserts one row and leaves past transactions unchanged; moving an expense's date to another month changes both months' figures; `GET /budgets` lists months newest first (default last 12, `from`/`to` honoured) with allowance, spent, remaining, percentage; invalid year or month returns 422; 401 without a session
- [X] T070 [P] [US4] Write failing tests in `frontend/tests/budget.test.tsx` (MSW): month picker (previous/next) loads the month; allowance form validates and saves, showing updated figures after the API confirms; spent, remaining and percentage display; over-budget shows text "Over by GH₵ 200.00" and not only colour; unset allowance shows "No allowance set" and "N/A"; recent months list is tappable and switches the month; loading, empty and error states

### Implementation for User Story 4

- [X] T071 [US4] Add `period_totals(db, user_id, start, end) -> PeriodTotals(income, expenses, fees)` to `backend/app/services/accounting.py` (expenses sum every expense row including fee rows; fees sum expense rows with a parent; income sums income rows; transfers excluded; never reads `fee_amount`)
- [X] T072 [P] [US4] Create `backend/app/schemas/budget.py` (`BudgetUpdate`, `BudgetSummary`, `BudgetList`) and `backend/app/repositories/budget_repository.py` (`get_for_month`, `upsert`, `list_between`)
- [X] T073 [US4] Create `backend/app/services/budget_service.py` (`summary(db, user_id, month_start)` using `accounting.period_totals`, `set_allowance` upsert, `list_months`) with percentage `round(spent / allowance * 100, 2)` only when the allowance is greater than zero, and `backend/app/api/budgets.py` (`GET /budgets`, `GET/PUT /budgets/{year}/{month}`); register it in `backend/app/main.py`; run `tests/test_budgets.py` until it passes
- [X] T074 [P] [US4] Create `frontend/src/api/budgets.ts` (hooks and invalidation) and `frontend/src/components/MonthPicker.tsx` (previous, current label via `monthLabel`, next; 48 px targets; keyboard operable)
- [X] T075 [US4] Replace `frontend/src/pages/BudgetPage.tsx`: month picker, allowance form (`MoneyField`), spent / remaining / percent cards with text-based over-budget state, last months list, loading/empty/error states; edits invalidate budgets and dashboard
- [X] T076 [US4] Run US4 tests (`pytest tests/test_budgets.py`, `npm test -- budget`), verify quickstart step 9 in the browser, run `frontend/scripts/mobile-audit.js` on `/budget` at all five viewport sizes and fix every finding

**Checkpoint**: Allowance tracking works (slice S4 done)

---

## Phase 8: User Story 5 - See the big picture on the dashboard (Priority: P2) Slice S5

**Goal**: One phone-friendly dashboard with balances, income, expenses, fees, net cash flow, allowance remaining, spending by category, income versus expenses over time and recent transactions.

**Independent Test**: With the worked example plus a few expenses, every dashboard figure equals a manual sum of the history.

### Tests for User Story 5 (write first, must FAIL before implementation) ⚠️

- [X] T077 [P] [US5] Write failing tests in `backend/tests/test_dashboard.py`: summary for the worked example shows income 0.00, expenses 5.00, fee_total 5.00 (a subset of expenses), net -5.00, combined 2295.00 and each account balance; transfers never appear in income, expenses, category totals or net; spending by category groups expense rows only, shows Fees as its own category, shares sum to 100.00 (largest-remainder rounding) and `total_expenses` equals the sum of items; `month`, `start_date`/`end_date` filters; cash flow groups by day for ranges up to 31 days and by month beyond, fills empty buckets with `0.00`, returns totals equal to the bucket sums, and honours `category_id`; recent transactions returns the latest 10 by date then creation including transfers and fees (`limit` 1–50); default month is the current month in Africa/Accra (fake clock); a month with no data returns zeros and empty lists; every figure equals the corresponding sum over `GET /transactions` for the same period; invalid month or reversed range returns 422; 401 without a session
- [X] T078 [P] [US5] Write failing tests in `frontend/tests/dashboard.test.tsx` (MSW): month picker changes every card; stat cards show balance, income, expenses, fees, net and allowance remaining via `formatGhs`; account balances list; spending-by-category shows bars plus a text list with amount and share; cash-flow chart shows a totals row and its range control (this month, last 3 months, custom); recent transactions list opens the detail; empty states for no data and per-section errors with retry; each chart has an accessible name and a text alternative; no element wider than the viewport
 
### Implementation for User Story 5

- [X] T079 [US5] Add `spending_by_category(db, user_id, start, end)` and `cash_flow(db, user_id, start, end, category_id=None)` to `backend/app/services/accounting.py` (SQL `GROUP BY`, expense rows only for categories, `generate_series` or Python filling for empty buckets, bucket `day` up to 31 days else `month`, shares by largest remainder so they total 100.00)
- [X] T080 [P] [US5] Create `backend/app/schemas/dashboard.py` (`DashboardSummary`, `SpendingByCategory`, `CashFlow`, `RecentTransactions`) per the contract
- [X] T081 [US5] Create `backend/app/services/dashboard_service.py` (summary composes `accounting.period_totals`, `accounting.account_balances`, `budget_service.summary`; spending, cash flow and recent delegate to accounting and `transaction_repository`) and `backend/app/api/dashboard.py` (`/dashboard/summary`, `/spending-by-category`, `/cash-flow`, `/recent-transactions`); register it in `backend/app/main.py`; run `tests/test_dashboard.py` until it passes
- [X] T082 [P] [US5] Create `frontend/src/api/dashboard.ts` (one hook per endpoint so sections load and fail independently)
- [X] T083 [P] [US5] Create `frontend/src/components/charts/SpendingByCategory.tsx` (Recharts horizontal `BarChart` in `ResponsiveContainer`, fixed height, value labels, followed by a text list of name, amount and share) and `frontend/src/components/charts/CashFlow.tsx` (grouped bars income vs expenses, compact legend, totals row, `aria-label` and a visually available data table or list)
- [X] T084 [US5] Replace `frontend/src/pages/DashboardPage.tsx`: `MonthPicker`, headline `StatCard`s, allowance card (with over-budget text), accounts list, the two charts, "Recent transactions" using `TransactionRow` and a "See all" link to History; section-level loading, empty and error states; single column on phones
- [X] T085 [US5] Run US5 tests (`pytest tests/test_dashboard.py`, `npm test -- dashboard`), verify quickstart steps 5 and 6, run `frontend/scripts/mobile-audit.js` on `/dashboard` at all five viewport sizes (charts must fit, no horizontal scroll, readable without hovering) and fix every finding

**Checkpoint**: All six user stories complete (slice S5 done)

---

## Phase 9: Polish & Cross-Cutting Concerns (Slice S6)

**Purpose**: Safety nets across stories, performance, mobile verification, documentation

- [X] T086 [P] Write `backend/tests/test_accounting_invariants.py`: seeded random sequence (fixed seed, about 200 operations through the API: income, expense, transfer with and without fee, payment with fee, edits of amount/date/account/fee, deletes); after every step assert sum of balances equals opening total plus income minus expenses, no fee row without an existing parent, at most one fee per parent, and at the end that `dashboard/summary`, `budgets`, `accounts` and sums over `GET /transactions` for every month agree to the pesewa
- [X] T087 [P] Write `backend/tests/test_concurrency.py`: 10 threads posting the same client `id` produce one parent (and one fee); two threads editing one transaction with the same `version` give one 200 and one 409 `stale_version`; concurrent transfers between the same accounts keep the sum of balances invariant; a transfer edit racing a delete leaves no orphan fee
- [X] T088 [P] Write `backend/tests/test_ownership.py` using `allow_second_user`: a second user's accounts, categories, transactions and fees return 404 on GET, PATCH, DELETE and archive; creating a transaction or transfer that references the other user's account or category returns 404; lists and dashboards never include the other user's rows
- [X] T089 [P] Extend `backend/tests/test_money_rules.py`: static check (source scan) that `func.sum`, `sum(` over money and `Decimal` additions appear only in `backend/app/services/accounting.py` and `backend/app/schemas/common.py`; no `float(` on money values anywhere under `backend/app`
- [X] T090 [P] Write `backend/tests/test_performance.py`: seed 1,500 transactions over 12 months through the repository, then assert the five dashboard and budget endpoints plus a 20-row History page complete in under 2 seconds in total on the test machine (SC-009)
- [X] T091 Make the polish tests pass; fix any defect they reveal in the services or constraints (adding a failing regression test first for each defect)
- [X] T092 [P] Frontend end-to-end flows in `frontend/tests/flows.test.tsx` (MSW with a small in-memory fake of the API): add expense → balances and dashboard refresh after confirmation; transfer with fee → History shows principal and fee separately; delete transfer → both gone; session expiry during Add redirects to login with the notice and the form is not submitted twice
- [X] T093 Run `frontend/scripts/mobile-audit.js` on every screen (Dashboard, History, filter sheet, Detail, Add (all three tabs, fee sections open), Accounts, Account form, Budget, Settings, More sheet, Login) at 320, 360, 375, 414 px and 667×375, record the results in `specs/002-finance-tracking-core/checklists/requirements.md` notes and fix every finding
- [X] T094 Keyboard-only pass in the browser: complete an expense, a transfer with fee and an edit using Tab, Enter, Space, arrow keys and Escape only; confirm visible focus, focus trapping in the filter sheet and confirm dialog, and focus return after closing; fix findings
- [X] T095 [P] Update `backend/README.md` (new endpoints summary, `alembic upgrade head` note, ownership test caveat) and `specs/roadmap.md` (mark 002–007 implemented once all checks pass)
- [X] T096 Security and secrets pass: confirm every new route appears in `test_protected_routes.py` output as requiring a session (the sweep reads OpenAPI), run the existing secret scan from feature 001 over the new files and the built bundle, and confirm logs from the new services contain only event names and IDs (add a test mirroring `test_no_secrets_or_credentials_in_logs` for create, edit and delete)
- [X] T097 Run everything: `ruff check` and `ruff format --check` and `pytest` in `backend/`, `npm run lint`, `npm run typecheck`, `npm run build` and `npm test` in `frontend/`; then walk through every step of `quickstart.md` in the browser at 375 px and note any deviation

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none
- **Foundational (Phase 2)**: after Setup; BLOCKS every story
- **US1 (Phase 3)**: after Foundational
- **US2 (Phase 4)**: after US1 (needs accounts and the accounting module)
- **US6 (Phase 5)**: after US2 (lists and edits what US2 creates)
- **US3 (Phase 6)**: after US2 (shares the transaction service, form and History row); extends US6 screens
- **US4 (Phase 7)**: after US3 (spent amount must include fees and exclude transfers)
- **US5 (Phase 8)**: after US4 (summary embeds the budget summary)
- **Polish (Phase 9)**: after the stories it exercises

### Within Each Story

- Tests first and failing; schemas and repositories before services; services before endpoints; backend endpoints before the frontend that calls them; frontend hooks before pages; mobile audit last
- Tasks touching the same file (`transaction_service.py`, `transaction.py` schema, `TransactionForm.tsx`, `NewTransactionPage.tsx`, `main.py`, `App.tsx`, `accounting.py`) run sequentially in phase order

### Parallel Opportunities

- Phase 2: all test-writing tasks together; models, `common.py`, `dates.py`, exceptions and category seeding together; frontend libs and shared UI together
- Each story: its backend test file and frontend test file(s) together; schema, repository and frontend API/schema files together
- Polish: the five new backend test files and the frontend flow test together

---

## Parallel Example: User Story 3

```bash
# Tests for User Story 3, all different files:
Task: "Write failing tests in backend/tests/test_transfers.py"
Task: "Write failing tests in backend/tests/test_fees.py"
Task: "Write failing tests in frontend/tests/transfer-form.test.tsx"
Task: "Write failing tests in frontend/tests/fees-ui.test.tsx"

# Independent building blocks:
Task: "Create backend/app/schemas/transfer.py and extend transaction schemas"
Task: "Create frontend/src/api/transfers.ts and frontend/src/schemas/transfer.ts"
Task: "Create frontend/src/components/FeeFields.tsx and TransferForm.tsx"
```

---

## Implementation Strategy

### MVP First (through User Story 3)

1. Setup, then Foundational (schema, primitives, shared UI)
2. US1 accounts, US2 income and expenses, US6 history, US3 transfers and fees (slices S1–S3)
3. **STOP and VALIDATE**: the bank/MoMo/cash worked example matches exactly (1,500 / 295 / 500; expenses 5) and the app is comfortable on a 375 px phone. This is a usable personal tracker; do not skip to reports before it passes.

### Incremental Delivery

1. S1 accounts → S2 income/expenses/history → S3 transfers/fees (usable MVP)
2. S4 allowance → S5 dashboard (reports on top of verified data)
3. S6 safety nets and full mobile audit, then feature 003 (deployment and backup, roadmap 008)

### Notes

- Constitution gates apply to every task: I exact money, II ledger integrity, III atomicity, IV owner-only, V test-first on PostgreSQL, VI layering, VII dates and simplicity; mobile-first is a standing owner requirement
- Commit after each task or logical group; never weaken a failing test to make it pass
- Avoid: summing money outside `accounting.py`, using `float` for money, committing inside repositories, adding custom categories or stored balances (out of scope)
