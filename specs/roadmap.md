# Feature Increment Roadmap

Derived from the Personal Finance Tracker v1.0 specification (section 9) and the constitution.
Each increment is specified with one `/speckit-specify` run, then planned, tasked and implemented
before the next. Backend-first, per the constitution.

| # | Directory | Scope | Spec requirements | Depends on |
|---|-----------|-------|-------------------|------------|
| 001 | `001-owner-auth-foundation` | Owner-only login/logout, sessions, provisioning, health, protected app shell | FR-01 | none |
| 002 | `002-accounts-opening-balances` | Bank/MoMo/cash accounts, opening balances, derived balances, archive | FR-02 | 001 |
| 003 | `003-income-expenses` | Categories, income and expense CRUD, filters, balance effects | FR-03, FR-04 | 002 |
| 004 | `004-transfers-automatic-fees` | Atomic transfers, linked fee expenses, edit/delete sync, payments with fees | FR-05, FR-06 | 003 |
| 005 | `005-monthly-allowance` | Monthly allowance, spent/remaining/percentage, overspending | FR-07 | 003, 004 |
| 006 | `006-dashboard-reporting` | Summary metrics, spending by category, cash flow, recent transactions, filters | FR-08 | 004, 005 |
| 007 | `007-frontend-experience` | Full screens for accounts, transactions, budget, settings, responsive/accessibility polish | UI spec (section 7) | 002–006 |
| 008 | `008-deployment-backup` | Production deployment, secrets, cookies/CORS, backup and tested restore | Phase 7, DoD | all |

Notes:

- Frontend screens for each increment may ship with that increment where small; 007 covers the
  remainder and cross-cutting polish.
- Status: 001 implemented. Increments 002–007 were bundled into one feature,
  `002-finance-tracking-core`, and are implemented (backend and mobile-first screens, all tasks
  checked, tests passing). Only 008 (deployment and backup) is not started.
- Within 002-finance-tracking-core, build in the order above (accounts, income/expenses,
  transfers and fees, allowance, dashboard, polish) so each slice can be tested on its own.
