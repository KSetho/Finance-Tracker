# Feature Specification: Finance Tracking Core

**Feature Branch**: `002-finance-tracking-core`  
**Created**: 2026-10-17  
**Status**: Draft  
**Input**: User description: "we're doing 002-007 into this feature. I also need this done quickly." Bundles roadmap increments 002–007 (accounts, income and expenses, transfers with automatic fees, monthly allowance, dashboard and reporting, and the full mobile-first screens) into one feature, building on the signed-in owner shell from 001. Production deployment (008) is separate.

## User Scenarios & Testing *(mandatory)*

The owner uses a phone most of the time. Every story below includes the phone experience: the flows are short, thumb-reachable and usable at 320 px wide.

### User Story 1 - Set up accounts with opening balances (Priority: P1)

The owner creates the places where their money lives: bank accounts, mobile money wallets and cash. Each has a name, a type and an opening balance as of a date. The owner sees every account with its current balance and the combined total, can rename an account, and can archive one they no longer use without losing its history.

**Why this priority**: Every other feature records money moving in, out or between accounts. Nothing else works until accounts exist.

**Independent Test**: Create a bank account with GH₵2,000, a mobile money account with GH₵300 and a cash account with GH₵0; confirm each balance and the combined total of GH₵2,300; archive one and confirm it disappears from the active total but its record remains.

**Acceptance Scenarios**:

1. **Given** no accounts exist, **When** the owner creates "MTN MoMo" (mobile money, opening balance GH₵300.00, opening date 01 Oct 2026), **Then** it appears in the account list with a balance of GH₵300.00 and no income entry is created.
2. **Given** three accounts exist, **When** the owner opens the accounts screen, **Then** each shows its current balance and the combined balance of active accounts is shown.
3. **Given** an account has recorded transactions, **When** the owner archives it, **Then** it no longer counts toward the combined balance or appears when choosing an account for new entries, and its past transactions remain visible.
4. **Given** an account exists, **When** the owner renames it, **Then** all past transactions show the new name.
5. **Given** the owner enters a negative or non-numeric opening balance, more than two decimal places, or a blank name, **When** they save, **Then** they see a clear message and nothing is saved.

---

### User Story 2 - Record income and expenses quickly (Priority: P1)

The owner records money coming in (salary, gift) and going out (groceries, transport). Each entry has a name, date, amount, optional description, an account and a category. From the phone's Add button the owner can log an expense in a few taps: amount, account, category, save. Balances update as soon as the entry is saved.

**Why this priority**: This is the product's core purpose and the data every report is built from.

**Independent Test**: With an account at GH₵1,000, record GH₵500 income then a GH₵100 expense; confirm the balance is GH₵1,400 and both entries are visible.

**Acceptance Scenarios**:

1. **Given** an account with GH₵1,000, **When** the owner records income of GH₵500 into it, **Then** the balance becomes GH₵1,500 and the entry counts as income.
2. **Given** an account with GH₵1,500, **When** the owner records an expense of GH₵100 from it, **Then** the balance becomes GH₵1,400 and the entry counts as an expense.
3. **Given** the Add screen, **When** the owner opens it, **Then** the date defaults to today, the most recently used account is preselected, and the first field to fill is the amount with a numeric keypad.
4. **Given** the owner enters a zero or negative amount, an amount with more than two decimal places, or leaves out a required field, **When** they save, **Then** they see which field to fix and nothing is saved.
5. **Given** an expense larger than the account balance, **When** the owner saves, **Then** it is recorded and the account balance shows as negative.
6. **Given** a save is in progress, **When** the owner taps Save again, **Then** only one entry is created.
7. **Given** a category list is shown, **When** the owner records income, **Then** only income categories are offered; for an expense only expense categories.

---

### User Story 3 - Move money between accounts and record fees (Priority: P1)

The owner moves money between their own accounts (bank to mobile money, mobile money to cash) and records any fee charged. A transfer never counts as income or spending; only the fee does, as a separate expense in a Fees category. The owner can also record sending money to another person as an expense, with an optional fee on that payment. Editing or deleting a transfer or payment updates its fee and balances together.

**Why this priority**: Moving money and fee charges are everyday events here, and getting them wrong double-counts money, which would make every report untrustworthy.

**Independent Test**: With Bank GH₵2,000, MoMo GH₵300, Cash GH₵0: transfer GH₵500 bank to MoMo; withdraw GH₵500 MoMo to cash with a GH₵5 fee charged to MoMo. Balances must be Bank 1,500, MoMo 295, Cash 500; income GH₵0; expenses GH₵5; total funds GH₵2,295.

**Acceptance Scenarios**:

1. **Given** Bank GH₵2,000 and MoMo GH₵300, **When** the owner transfers GH₵500 from Bank to MoMo with no fee, **Then** Bank is GH₵1,500, MoMo is GH₵800, and income and expenses are unchanged.
2. **Given** a transfer with a GH₵5 fee charged to the MoMo account, **When** it is saved, **Then** the principal moves once, one GH₵5 expense in the Fees category is created dated the same as the transfer, MoMo is reduced by the fee, and expenses increase by GH₵5 only once.
3. **Given** a fee can be charged to either the sending or receiving account, **When** the owner chooses which one, **Then** the fee is deducted from that account.
4. **Given** the owner sends GH₵100 to another person with a GH₵2 fee, **When** it is saved, **Then** two expenses exist (GH₵100 and GH₵2), expenses increase by GH₵102 and the account decreases by GH₵102.
5. **Given** a transfer with a fee, **When** the owner changes the amount, accounts, date or fee, **Then** both balances and the fee expense update together; changing the fee to zero removes the fee expense.
6. **Given** a transfer with a fee, **When** the owner deletes it, **Then** the transfer and its fee expense are both removed and all balances return to what they were before.
7. **Given** the source and destination are the same account, or an account is archived, **When** the owner saves, **Then** it is refused with a clear message.
8. **Given** something fails while saving a transfer, **When** the owner reloads, **Then** no partial change exists: neither balances nor fee changed.
9. **Given** a fee expense created automatically, **When** the owner views it in history, **Then** it is labelled as a fee linked to its transfer, and it can only be changed by editing the transfer or payment.

---

### User Story 4 - Set a monthly spending allowance (Priority: P2)

The owner sets how much they plan to spend in a calendar month and sees, for any month, how much has been spent, how much remains and what percentage is used. Spending beyond the allowance shows a negative remainder, not an error. Changing the allowance never changes past transactions.

**Why this priority**: It turns the records into a spending plan, but the records themselves are useful without it.

**Independent Test**: Set October's allowance to GH₵3,000 and record GH₵1,200 of expenses that month; confirm remaining GH₵1,800 and 40% used; add GH₵2,000 more and confirm remaining is -GH₵200.

**Acceptance Scenarios**:

1. **Given** an allowance of GH₵3,000 and GH₵1,200 spent in the month, **Then** the budget screen shows spent GH₵1,200, remaining GH₵1,800 and 40.00% used.
2. **Given** spending exceeds the allowance, **Then** remaining is shown as a negative amount and clearly marked as over budget.
3. **Given** a month with fees, **Then** fee expenses count once toward the spent amount and transfer principals never count.
4. **Given** the owner edits the allowance, **Then** past transactions are unchanged and the displayed figures recalculate.
5. **Given** a month with no allowance set or an allowance of zero, **Then** spent is still shown, remaining is shown against zero or marked "no allowance set", and percentage used shows "N/A".
6. **Given** an expense is moved from one month to another by editing its date, **Then** both months' figures update correctly.
7. **Given** the budget screen, **When** the owner picks a previous month, **Then** that month's allowance and figures are shown.

---

### User Story 5 - See the big picture on the dashboard (Priority: P2)

The owner opens the dashboard and sees, for the selected month: account balances and the combined total, income, expenses (with fees shown as part of them), net cash flow, allowance remaining, spending by category, income versus expenses over time, and the latest transactions. Filters change the period, categories and transaction types shown. On a phone the dashboard is a single readable column of cards and charts.

**Why this priority**: Reliable summaries are the payoff of recording, but depend on all earlier stories.

**Independent Test**: Using the bank, MoMo and cash example plus a few expenses, confirm every dashboard figure equals what a manual sum of the transaction history gives.

**Acceptance Scenarios**:

1. **Given** recorded activity, **When** the owner opens the dashboard, **Then** income, expenses, fee total (a subset of expenses), net cash flow (income minus expenses), allowance remaining and each account balance are shown, and they reconcile with the transaction list.
2. **Given** transfers exist, **Then** they appear in neither income, expenses, spending by category nor net cash flow.
3. **Given** the spending-by-category chart, **Then** fees appear as their own Fees category and each category's share matches its total.
4. **Given** the income-versus-expenses chart, **When** the owner picks a date range, **Then** totals are grouped by day for ranges up to 31 days and by month for longer ranges.
5. **Given** no data for the selected period, **Then** helpful empty states are shown instead of blank or broken charts.
6. **Given** the owner changes the month, **Then** all figures reflect that month by transaction date, never by when it was entered.
7. **Given** a phone at 320 px, **Then** nothing scrolls horizontally, charts fit the width and are readable, and each figure is understandable without hovering.
8. **Given** the latest-transactions list, **Then** it shows the most recent entries including transfers and fees, each tappable to open its details.

---

### User Story 6 - Browse, filter, edit and delete history (Priority: P2)

The owner can browse every transaction (income, expenses, transfers and fees) newest first, search by name, filter by date range, type, category and account, sort, and open any entry to edit or delete it after a confirmation. Transfers show principal and fee separately. Editing a date across months keeps all monthly figures correct.

**Why this priority**: Mistakes happen; being able to find and correct them keeps the numbers trustworthy.

**Independent Test**: Record entries across two months, filter to one category and date range, edit one entry's amount and another's date, delete one with confirmation, and confirm balances and monthly figures all follow.

**Acceptance Scenarios**:

1. **Given** many transactions, **When** the owner opens History, **Then** the newest are shown first in pages, with a clear way to load more.
2. **Given** filters for date range, type, category and account and a search by name, **When** applied, **Then** only matching entries show and the active filters are visible and clearable.
3. **Given** an income or expense, **When** the owner edits its name, description, date, amount, account or category, **Then** balances and reports update; the type cannot be changed (delete and re-enter instead).
4. **Given** the owner deletes an entry, **Then** they are asked to confirm, and after confirming balances and reports no longer include it.
5. **Given** a transfer with a fee, **Then** the list and detail show the principal and the fee on separate lines, and the fee expense is not editable or deletable by itself.
6. **Given** a different month is chosen when editing the date, **Then** the entry leaves the old month's totals and enters the new one's.
7. **Given** no entries match, **Then** an empty state offers to clear filters.

---

### Edge Cases

- An account may go negative (overdraft or a forgotten entry): the balance shows as negative and the owner is not blocked.
- Amounts are in Ghana cedi only, stored and shown to exactly two decimal places; there are no rounding surprises: sums of displayed values equal displayed totals.
- Archived accounts keep their history but cannot be chosen for new or edited entries; archiving an account with a non-zero balance asks the owner to confirm.
- Accounts are archived, never deleted, so history is never orphaned.
- Editing an account's opening balance or opening date recalculates its balance; activity dated before its opening date is refused with a message.
- Two quick taps on Save, a flaky connection and a retry must never produce duplicate entries or duplicate fees.
- Two devices editing the same entry: the later save wins, and the earlier device is told the entry changed when it next tries to save.
- A transaction dated in the future is allowed (planned or scheduled payments) and counts in the month of its date.
- Month boundaries use calendar months in the Ghana time zone; an entry made late on the last evening of a month belongs to that month.
- A fee equal to or greater than the transfer principal is allowed; a fee of zero creates no fee expense.
- Deleting or editing an entry that belongs to a month with an allowance recalculates that month immediately.
- Another owner's data does not exist in this product, but every request still validates that referenced accounts and categories belong to the signed-in owner.
- Very long names or descriptions are limited with a visible counter; leading and trailing spaces are ignored.
- The session expires mid-entry: the owner is asked to sign in again and does not lose confidence that nothing partial was saved.

## Requirements *(mandatory)*

### Functional Requirements

**Accounts**

- **FR-001**: The owner MUST be able to create an account with a name, a type (bank, mobile money or cash), an opening balance (zero or more) and an opening date.
- **FR-002**: The system MUST show each account's current balance, calculated from its opening balance and its recorded activity, and the combined balance of all active accounts.
- **FR-003**: The owner MUST be able to rename an account and correct its opening balance or date; the balance MUST recalculate and activity dated before the opening date MUST be refused.
- **FR-004**: The owner MUST be able to archive an account; archived accounts MUST keep their history, MUST be excluded from the combined balance and from account choices for new or edited entries.
- **FR-005**: Opening balances MUST NOT create income entries or count as income.

**Income and expenses**

- **FR-006**: The owner MUST be able to record income with name, date, amount, optional description, destination account and optional category.
- **FR-007**: The owner MUST be able to record an expense with name, date, amount, optional description, source account and category.
- **FR-008**: Income MUST increase the chosen account and count as income; an expense MUST decrease the chosen account and count as spending.
- **FR-009**: The system MUST provide default categories: income (Salary, Freelance, Business, Gift, Other income) and expense (Food, Transport, Bills, Shopping, Health, Family, Fees, Other expense), offering income categories for income and expense categories for expenses.
- **FR-010**: The owner MUST be able to view, edit and delete income and expenses; deletion MUST require confirmation.
- **FR-011**: Amounts MUST be greater than zero with at most two decimal places; invalid input MUST be refused with a message naming the field.

**Transfers and fees**

- **FR-012**: The owner MUST be able to record a transfer with source account, destination account, date, amount, name and optional description; the two accounts MUST differ and neither may be archived.
- **FR-013**: A transfer MUST reduce the source and increase the destination by the same amount in one atomic step and MUST NOT count as income or expense.
- **FR-014**: A transfer or a payment to another person MAY include a fee amount and the account charged; a nonzero fee MUST automatically create exactly one linked expense in the Fees category, dated the same as the parent, deducted from the charged account and counted once in expenses.
- **FR-015**: A payment to another person MUST be recorded as an expense (principal) with its fee as a separate linked expense.
- **FR-016**: Editing a transfer or payment MUST update its balances and its linked fee together (create, change or remove the fee as needed); deleting it MUST delete its fee; no step may leave partial changes or a dangling fee.
- **FR-017**: A linked fee expense MUST be visible and clearly labelled, and MUST NOT be edited or deleted on its own.
- **FR-018**: A failure at any point while saving a multi-part operation MUST leave no partial change.

**Monthly allowance**

- **FR-019**: The owner MUST be able to set and edit one allowance per calendar month (zero or more) without changing any past transaction.
- **FR-020**: For a chosen month the system MUST show allowance, amount spent (all expenses dated in the month including fees, never transfer principals), amount remaining (allowance minus spent, possibly negative) and percentage used (spent divided by allowance, or "N/A" when the allowance is zero or unset).
- **FR-021**: The owner MUST be able to view and compare previous months' allowances and results.

**Dashboard and reporting**

- **FR-022**: The dashboard MUST show for the selected month: income, expenses, fees (as a subset of expenses), net cash flow, allowance remaining, combined balance and every account's balance.
- **FR-023**: The dashboard MUST show spending by category (fees as their own category), income versus expenses over a chosen date range (grouped by day up to 31 days, otherwise by month), and the most recent transactions.
- **FR-024**: Dashboard, account, budget and history figures MUST always agree with each other and with the transaction history.
- **FR-025**: Reports MUST be filterable by month, date range, category and transaction type.

**History**

- **FR-026**: The owner MUST be able to list all transactions newest first in pages, search by name, filter by date range, type, category and account, and sort by date or amount.
- **FR-027**: Transfers MUST display principal and fee separately; transfer principals MUST NOT appear in any spending view.
- **FR-028**: Editing a transaction's date MUST move it between months' figures correctly.

**Experience and integrity**

- **FR-029**: All screens MUST be designed for a 320–414 px phone first and adapt to larger screens, with loading, empty, validation-error and request-error states on every screen.
- **FR-030**: Adding a transaction MUST be reachable from every screen in one tap, default the date to today and the account to the most recently used one, and use a numeric keypad for amounts.
- **FR-031**: Forms MUST prevent duplicate submissions while a save is in progress, and retrying a save MUST NOT create duplicates.
- **FR-032**: Dates MUST display as `DD MMM YYYY` and amounts as `GH₵` with two decimals; month boundaries follow the Ghana time zone.
- **FR-033**: Every record and every reference supplied by the owner's device MUST be checked to belong to the signed-in owner, and every endpoint MUST require sign-in.
- **FR-034**: Monetary calculations MUST be exact to two decimal places and MUST NOT depend on the device's arithmetic.

### Key Entities

- **Account**: A place where money is held. Name, type (bank, mobile money, cash), opening balance and date, archived flag. Current balance is derived, never typed in.
- **Category**: A label for income or expense entries, with a type (income or expense) and a built-in flag. Fees has its own built-in category.
- **Transaction**: A dated money event of type income, expense or transfer. Has a name, optional description, positive amount, date, the account(s) involved, optional category, and for transfers or payments an optional fee.
- **Linked fee expense**: The automatically created expense for a parent transfer or payment's fee; at most one per parent; the one record counted in expenses.
- **Monthly allowance**: A spending plan for one calendar month, one per month, never negative.
- **Summary figures** (derived): per-month income, expenses, fees, net cash flow, remaining allowance, percentage used, category totals, balances.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a phone, the owner can record a typical expense (amount, account, category, save) in under 20 seconds from any screen.
- **SC-002**: Starting from the worked example (Bank 2,000, MoMo 300, Cash 0, transfer 500, withdrawal 500, fee 5), the app shows balances 1,500 / 295 / 500, income GH₵0, expenses GH₵5 and total funds GH₵2,295, matching a manual calculation exactly.
- **SC-003**: For 100% of tested scenarios (income, expense, transfer, fee, payment-with-fee, edit, delete, month change), dashboard totals, account balances, budget figures and history sums agree to the pesewa.
- **SC-004**: No scenario produces income or expense from a transfer principal or an opening balance, and no fee is ever counted twice.
- **SC-005**: Deleting or editing a transfer with a fee leaves zero orphaned fee entries and restores or updates both balances correctly in 100% of tested cases.
- **SC-006**: A failure injected partway through any multi-part save leaves the data identical to before the attempt.
- **SC-007**: With the allowance example (GH₵3,000, GH₵1,200 spent), remaining shows GH₵1,800 and 40.00%; overspending shows a negative remainder with no error.
- **SC-008**: Every screen is usable at 320 px portrait and landscape phones through desktop: no horizontal scrolling, tap targets at least 44 px, text at least 12 px, charts readable without hovering, and operable by keyboard.
- **SC-009**: The dashboard loads and shows all figures within 2 seconds for a year of daily use (about 1,500 transactions) on a typical phone connection.
- **SC-010**: In a trial with the owner, at least 90% of first-time attempts to add an income, an expense and a transfer succeed without help.
- **SC-011**: Double-tapping Save or retrying after a dropped connection creates exactly one entry in 100% of tested cases.

## Assumptions

- This feature delivers roadmap increments 002–007 together; deployment, backups and production configuration remain a separate later feature. It builds on the owner sign-in and app shell delivered by 001, and replaces its placeholder pages.
- Single owner, single currency (Ghana cedi), manual entry only. Bank connections, SMS parsing, shared users, category-specific budgets, loans, investments, currency conversion and advice stay out of scope.
- Categories are the built-in defaults listed in FR-009; creating, renaming or deleting custom categories is out of scope for now.
- Accounts may have negative balances; the app shows them but does not block entries.
- Future-dated transactions are allowed.
- A transaction's type cannot be changed by editing; delete and re-enter.
- The Fees category may also be picked for an ordinary expense, but only automatically created fee expenses are linked to a parent.
- A fee's date is always its parent's date, and a fee's account defaults to the parent's source account if not chosen.
- "Most recently used account" is remembered from the owner's latest saved entry.
- List pages show 20 entries by default; the dashboard's recent list shows the latest 10.
- Charts show totals in cedi to two decimals, grouped as described in FR-023; chart styling and exact layout are design decisions for planning.
- The performance target in SC-009 assumes one owner's data volume, not a multi-user load.
