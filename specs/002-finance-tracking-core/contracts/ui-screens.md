# Contract: Screens and mobile behaviour

Mobile-first: every screen is designed at 320–414 px portrait first, then widened. Standing checks for
every screen: no horizontal scroll, tap targets at least 44 px (controls 48 px), text at least 12 px
(inputs 16 px), loading / empty / validation-error / request-error states, keyboard operable. The
existing shell from 001 (bottom tab bar with Home, History, Add, Accounts, More; desktop sidebar)
hosts these screens.

## Routes

| Route | Screen | Purpose |
|---|---|---|
| `/dashboard` | Dashboard | Month picker, balance and cash-flow cards, allowance card, spending by category, income vs expenses, recent transactions |
| `/transactions` | History | Search, filter sheet, sorted list in pages, tap row for detail |
| `/transactions/new` | Add | Segmented control: Expense, Income, Transfer |
| `/transactions/:id` | Detail / edit | Read view with Edit and Delete (confirm); transfers show principal and fee on separate lines |
| `/accounts` | Accounts | Account cards with balances, combined total, "New account", archived toggle |
| `/accounts/new`, `/accounts/:id/edit` | Account form | Name, type, opening balance, opening date; Archive on edit |
| `/budget` | Monthly budget | Month picker, allowance form, spent / remaining / % used, last months list |
| `/calendar` | Transaction calendar | Monday-first month grid, daily exact totals, transaction drilldown and add-on-date action |
| `/settings` | Settings | Owner email, Logout (from 001) |

## Add screen (the most-used flow)

- Opens on **Expense**; the **amount** field is first and focused, `inputMode="decimal"`, 16 px text.
- Order of fields (expense): amount, account (preselected: last used), category, date (today in
  `Africa/Accra`), name, then a collapsed "Add details" (description) and "Sent to someone else? Add a
  fee" (fee amount, fee account).
- Income: amount, account, category (optional), date, name.
- Transfer: amount, from, to, date, name, collapsed "Add a fee" (fee amount, charged to From or To).
- Native `<select>` plus the shared accessible sheet calendar for dates. Name defaults to the category
  name when left blank for expenses and income.
- A single sticky **Save** button above the keyboard-safe area; disabled and labelled "Saving…" while a
  request is pending. The form's client `id` is reused for retries and renewed after success.
- Success returns to the previous screen (or the History list) with a short confirmation; figures on
  other screens refresh only after the API confirms.

## Money and dates in the UI

- Amounts display as `GH₵ 1,234.50` from the server's decimal string; negative balances show a minus sign
  and the over-budget state is also conveyed by text ("Over by GH₵ 200.00"), not colour alone.
- Dates display as `DD MMM YYYY`. Form date defaults use `Africa/Accra`.
- The shared date picker preserves `YYYY-MM-DD`, min/max constraints and keyboard arrow navigation.
- The browser does not add, subtract or compare money; it formats what the server returns and validates
  typed input against `^\d{1,12}(\.\d{1,2})?$`.

## Charts

- Spending by category: horizontal bars with a text list (category, amount, share) below.
- Income vs expenses: grouped bars (day or month buckets) with totals row; fixed height, full width,
  no horizontal scroll; each chart has a text alternative.

## States every screen implements

| State | Behaviour |
|---|---|
| Loading | Skeleton or "Loading…" in the content area; no layout jump |
| Empty | Friendly message with the next action (for example "Add your first account") |
| Validation error | Message next to the field; form keeps its values |
| Request error | Banner with retry; for `stale_version` explain that the entry changed and offer to reload |
| Session expired | Redirect to login with the notice from 001 |
