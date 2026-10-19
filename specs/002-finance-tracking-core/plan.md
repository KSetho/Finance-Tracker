# Implementation Plan: Finance Tracking Core

**Branch**: `002-finance-tracking-core` | **Date**: 2026-10-17 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/002-finance-tracking-core/spec.md`

## Summary

Deliver the whole money-tracking product on top of the 001 owner shell: accounts with derived balances,
income and expenses, atomic transfers with automatic linked fee expenses, a monthly allowance, a
dashboard with reports, and full mobile-first screens. One shared accounting module computes every
figure; PostgreSQL constraints enforce the ledger invariants; creates are idempotent by client-supplied
UUID; edits use optimistic versions. Delivered in six vertical slices (accounts, income/expenses and
history, transfers and fees, allowance, dashboard, polish) so the app is usable after each. Design
choices are in [research.md](research.md), schema in [data-model.md](data-model.md), interfaces in
[contracts/](contracts/).

## Technical Context

**Language/Version**: Python 3.12 (backend); TypeScript 5.x on Node.js 20+ (frontend)  
**Primary Dependencies**: Backend as 001 (FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2, psycopg 3); frontend as 001 plus Recharts  
**Storage**: PostgreSQL; new tables `accounts`, `categories`, `transactions`, `monthly_budgets` (Alembic `0002_finance_core`)  
**Testing**: pytest on real PostgreSQL (unit, integration, invariants, concurrency, ownership); Vitest + React Testing Library + MSW; scripted in-browser mobile audit  
**Target Platform**: Modern phone browsers first (320–414 px), then tablet and desktop; Linux server  
**Project Type**: Web application (existing `backend/` + `frontend/`)  
**Performance Goals**: Dashboard (summary + charts + recent) loads within 2 s for about 1,500 transactions on a phone connection; list pages under 300 ms server time at that volume; add-expense flow under 20 s for the user (SC-001)  
**Constraints**: Exact money (`NUMERIC(14,2)`, `Decimal`, decimal strings, no float arithmetic); fee counted once; transfers never income or expense; all multi-row writes in one DB transaction; every ID validated against the owner; mobile-first (no horizontal scroll, 44 px targets, 12 px text, 16 px inputs); dates `DATE`, `Africa/Accra`  
**Scale/Scope**: One owner, roughly 1,500 transactions a year, 3–10 accounts; about 28 endpoints, 9 screens

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. Exact money**: `NUMERIC(14,2)` columns; Pydantic `Money` type (two decimals, strings in JSON);
      backend uses `Decimal` only; frontend formats server strings and does no money arithmetic (R4).
- [x] **II. Ledger integrity**: transfers and opening balances excluded from income/expense; one linked
      fee expense per parent, counted once via the expense rows and never from `fee_amount`; balances
      derived from one SQL expression; `services/accounting.py` is the single source for account,
      budget, dashboard and history figures (R1, R3).
- [x] **III. Atomicity**: parent and fee are created, updated and deleted in one DB transaction with
      row locks; CHECKs, composite foreign keys, a unique partial index and `ON DELETE CASCADE`
      enforce invariants in the database (R2, R6).
- [x] **IV. Owner-only security**: every route behind the 001 session; all new state-changing routes
      inherit the Origin and CSRF checks; ownership enforced by the composite foreign keys and
      service validation, with 404 for foreign IDs (R11); no new secrets.
- [x] **V. Test-first on PostgreSQL**: tests written first per slice, including invariants,
      concurrency and ownership suites; every accounting rule in the spec has a test (R15).
- [x] **VI. Layering**: routes thin; rules in `services/`; SQL in `repositories/` and `accounting.py`;
      schema by Alembic migration.
- [x] **VII. Dates & simplicity**: `DATE`/`TIMESTAMPTZ`, `Africa/Accra` (R10); scope limited to the
      spec; no custom categories, no stored balances, no idempotency-key table (YAGNI).
- [x] **Standing owner requirement (not yet a constitution principle)**: mobile-first design and
      verification, captured as FR-029/FR-030, SC-008 and the mobile audit step in every slice.

**Post-design re-check (after Phase 1)**: all gates pass; Complexity Tracking is empty. Two points to
watch during build: (1) a second user row is needed for ownership tests, so the test harness drops
the single-owner index inside the test database only; (2) the shared accounting module must stay the
only place that sums money (a test greps the code for `sum(`/`func.sum` outside it).

## Project Structure

### Documentation (this feature)

```text
specs/002-finance-tracking-core/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── finance-api.yaml     # OpenAPI for accounts, categories, transactions, transfers, budgets, dashboard
│   └── ui-screens.md        # routes, Add flow, states, charts, mobile rules
├── checklists/
│   └── requirements.md
└── tasks.md                 # /speckit-tasks output (not created here)
```

### Source Code (repository root)

```text
backend/
├── app/
│   ├── api/
│   │   ├── accounts.py              # /accounts, /accounts/{id}, /accounts/{id}/archive
│   │   ├── categories.py            # /categories
│   │   ├── transactions.py          # /transactions, /income, /expenses, /{id}
│   │   ├── transfers.py             # /transfers, /transfers/{id}
│   │   ├── budgets.py               # /budgets, /budgets/{year}/{month}
│   │   └── dashboard.py             # /dashboard/*
│   ├── models/
│   │   ├── account.py  category.py  transaction.py  budget.py
│   ├── schemas/
│   │   ├── common.py                # Money type, Month, pagination
│   │   ├── account.py  category.py  transaction.py  transfer.py  budget.py  dashboard.py
│   ├── services/
│   │   ├── accounting.py            # the ONLY place that sums money (balances, period totals, categories, cash flow)
│   │   ├── account_service.py
│   │   ├── category_service.py      # default seeding, validation helpers
│   │   ├── transaction_service.py   # income/expense create, edit, delete, list
│   │   ├── transfer_service.py      # transfers + fee sync (shared fee logic lives here)
│   │   ├── budget_service.py
│   │   └── dashboard_service.py
│   ├── repositories/
│   │   ├── account_repository.py  category_repository.py  transaction_repository.py  budget_repository.py
│   └── core/
│       └── dates.py                 # Africa/Accra today/month helpers, month ranges
├── migrations/versions/0002_finance_core.py
└── tests/
    ├── test_accounts.py  test_transactions.py  test_transfers.py  test_budgets.py  test_dashboard.py
    ├── test_accounting_invariants.py   # random operation sequence, everything reconciles
    ├── test_concurrency.py             # duplicate creates, conflicting edits
    ├── test_ownership.py               # second user row, cross-owner IDs return 404
    ├── test_finance_migration.py       # constraints, cascade, seeding, downgrade/upgrade
    └── test_money_rules.py             # Money type, only accounting.py sums

frontend/
├── src/
│   ├── api/
│   │   ├── accounts.ts  categories.ts  transactions.ts  transfers.ts  budgets.ts  dashboard.ts
│   │   └── queryKeys.ts
│   ├── lib/
│   │   ├── money.ts                 # validation regex, GH₵ formatting from strings, no arithmetic
│   │   └── dates.ts                 # DD MMM YYYY, Africa/Accra today/month
│   ├── schemas/                     # Zod: account, income, expense, transfer, budget
│   ├── components/
│   │   ├── ui/                      # + Select, DateField, MoneyField, Segmented, Sheet, ConfirmDialog, EmptyState, Skeleton
│   │   ├── AccountCard.tsx  TransactionRow.tsx  MonthPicker.tsx  StatCard.tsx
│   │   └── charts/                  # SpendingByCategory.tsx, CashFlow.tsx
│   ├── pages/
│   │   ├── DashboardPage.tsx  TransactionsPage.tsx  NewTransactionPage.tsx  TransactionDetailPage.tsx
│   │   ├── AccountsPage.tsx  AccountFormPage.tsx  BudgetPage.tsx  SettingsPage.tsx
│   └── hooks/                       # useIdempotentId, useLastAccount (+ existing useKeyboardOpen)
├── scripts/
│   └── mobile-audit.js              # console script: overflow, tap targets, font sizes, clipped labels
└── tests/                           # one file per screen/flow, money.test.ts, dates.test.ts
```

**Structure Decision**: Extend the existing web application layout from 001; backend follows the
constitution's mandated layers and the product specification's module names, with `accounting.py` and
`core/dates.py` added. The frontend replaces 001's placeholder pages and adds shared form components.

## Delivery slices

Each slice: tests first, backend and frontend together, mobile audit, then a checkpoint.

| Slice | Delivers | Spec stories | Checkpoint |
|---|---|---|---|
| S1 | Migration `0002`, models, `Money`, `accounting.balance`, accounts API + screens | US1 | Accounts screen shows balances and combined total at 320 px |
| S2 | Categories, income and expense API, History list/detail/edit/delete, Add screen (Expense, Income) | US2, US6 | Expense in under 20 s; edit date across months moves figures |
| S3 | Transfer API, shared fee logic, payment-with-fee, transfer screens, atomic edit/delete | US3 | Worked example matches exactly (1,500 / 295 / 500); rollback test passes |
| S4 | Budget API and Budget screen | US4 | 3,000 allowance, 1,200 spent: 1,800 remaining, 40.00% |
| S5 | Dashboard APIs, charts, recent list | US5 | Dashboard figures reconcile with History sums |
| S6 | Invariants, concurrency, ownership suites; mobile audit across all screens; empty/error states; polish | all | Definition of done in spec SC-001–SC-011 |

## Complexity Tracking

No constitution violations. Table intentionally empty.
