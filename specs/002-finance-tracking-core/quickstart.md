# Quickstart: Finance Tracking Core

Builds on the 001 setup (`backend/README.md`: database, `.env`, `alembic upgrade head`, owner
provisioning). Steps marked *(after S#)* only work once that slice is built.

## 1. Migrate and run

```bash
docker compose up -d db
cd backend && source .venv/bin/activate
alembic upgrade head                      # adds accounts, categories, transactions, monthly_budgets
uvicorn app.main:create_app --factory --reload --port 8000
```

```bash
cd frontend && npm install && npm run dev
```

Open the app on a phone-sized viewport (browser device toolbar at 375 px) and sign in as the owner.
The default categories are created when the owner is provisioned, or by the migration if the owner
already exists.

## 2. The worked example (must match exactly)

Do this through the UI (phone viewport); the checks are the acceptance test for the accounting rules.

1. *(after S1)* Accounts → New account: **Bank** (bank) GH₵2,000.00, **MoMo** (mobile money) GH₵300.00,
   **Cash** (cash) GH₵0.00, all opening 01 Oct 2026. Combined balance shows **GH₵2,300.00**.
2. *(after S3)* Add → Transfer: GH₵500.00 Bank → MoMo, no fee. Bank 1,500.00, MoMo 800.00.
3. *(after S3)* Add → Transfer: GH₵500.00 MoMo → Cash with a GH₵5.00 fee charged to MoMo.
4. Check: Bank **1,500.00**, MoMo **295.00**, Cash **500.00**, combined **2,295.00**.
5. *(after S5)* Dashboard for October 2026: income **GH₵0.00**, expenses **GH₵5.00**, fees **GH₵5.00**
   (a subset of expenses), net cash flow **-GH₵5.00**, and spending by category shows only Fees.
6. History shows the two transfers and one fee line labelled as linked to its transfer.

## 3. Allowance and payments

7. *(after S2)* Add → Expense: GH₵150.00 Groceries from Bank, category Food.
8. *(after S3)* Add → Expense with "Sent to someone else? Add a fee": GH₵100.00 from MoMo, fee GH₵2.00.
   Expenses rise by GH₵102.00 and MoMo falls by GH₵102.00 (two separate expense rows).
9. *(after S4)* Budget → October allowance GH₵3,000.00. Spent shows GH₵257.00 (5 + 150 + 102),
   remaining GH₵2,743.00, 8.57% used. Set the allowance to GH₵200.00: remaining **-GH₵57.00**, marked over
   budget, percentage 128.50%.

## 4. Edits, deletes, retries

10. Open the GH₵500 MoMo→Cash transfer: change the fee to GH₵0.00 (fee line disappears, MoMo +5.00); set
    it back to GH₵5.00 (fee line returns).
11. Delete the transfer (confirm): both its balances and its fee are gone; Bank/MoMo/Cash revert.
12. Change an expense's date to a day in September: October's figures drop and September's rise.
13. Double-tap Save on Add, or turn the network off and on while saving: exactly one entry exists.

## 5. Mobile audit (every slice)

With the dev servers running, open DevTools device mode (or the Browser pane) at **320, 360, 375, 414 px
portrait and 667×375 landscape** and run the script in `frontend/scripts/mobile-audit.js` from the console
on each screen. It must report: no horizontal scroll, no tap target under 44 px, no text under 12 px, no
clipped tab labels.

## 6. Tests

```bash
cd backend && pytest                      # real PostgreSQL via docker compose
cd frontend && npm run lint && npm run typecheck && npm test
```
