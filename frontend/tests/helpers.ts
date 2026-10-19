import { http, HttpResponse } from "msw";
import { server } from "./server";

export const session = {
  user: { id: "11111111-1111-1111-1111-111111111111", email: "owner@example.com" },
  csrf_token: "csrf-1",
  expires_at: "2026-10-24T12:00:00Z",
};

export function signedIn() {
  server.use(http.get("/api/v1/auth/me", () => HttpResponse.json(session)));
}

export function apiError(code: string, message: string, status: number) {
  return HttpResponse.json({ error: { code, message } }, { status });
}

export type AccountFixture = {
  id: string;
  name: string;
  account_type: "bank" | "mobile_money" | "cash";
  opening_balance: string;
  opening_date: string;
  is_archived: boolean;
  balance: string;
};

export function account(overrides: Partial<AccountFixture> = {}): AccountFixture {
  return {
    id: "aaaaaaaa-0000-0000-0000-000000000001",
    name: "Bank",
    account_type: "bank",
    opening_balance: "2000.00",
    opening_date: "2026-10-01",
    is_archived: false,
    balance: "2000.00",
    ...overrides,
  };
}

export const bank = account();
export const momo = account({
  id: "aaaaaaaa-0000-0000-0000-000000000002",
  name: "MoMo",
  account_type: "mobile_money",
  opening_balance: "300.00",
  balance: "300.00",
});
export const cash = account({
  id: "aaaaaaaa-0000-0000-0000-000000000003",
  name: "Cash",
  account_type: "cash",
  opening_balance: "0.00",
  balance: "0.00",
});

export type CategoryFixture = {
  id: string;
  name: string;
  category_type: "income" | "expense";
  is_system: boolean;
};

const cat = (id: string, name: string, category_type: "income" | "expense"): CategoryFixture => ({
  id,
  name,
  category_type,
  is_system: true,
});

export const categories = {
  salary: cat("cccccccc-0000-0000-0000-000000000001", "Salary", "income"),
  gift: cat("cccccccc-0000-0000-0000-000000000002", "Gift", "income"),
  food: cat("cccccccc-0000-0000-0000-000000000011", "Food", "expense"),
  transport: cat("cccccccc-0000-0000-0000-000000000012", "Transport", "expense"),
  fees: cat("cccccccc-0000-0000-0000-000000000013", "Fees", "expense"),
};

export function financeHandlers(
  options: { accounts?: AccountFixture[]; cats?: CategoryFixture[] } = {},
) {
  const accounts = options.accounts ?? [bank, momo, cash];
  const cats = options.cats ?? Object.values(categories);
  server.use(
    http.get("/api/v1/accounts", () =>
      HttpResponse.json({ items: accounts, combined_balance: "2300.00" }),
    ),
    http.get("/api/v1/categories", ({ request }) => {
      const type = new URL(request.url).searchParams.get("type");
      return HttpResponse.json({ items: cats.filter((c) => !type || c.category_type === type) });
    }),
    http.get("/api/v1/transactions", () =>
      HttpResponse.json({ items: [], page: 1, page_size: 20, total: 0 }),
    ),
  );
}

export type TransactionFixture = {
  id: string;
  type: "income" | "expense" | "transfer";
  name: string;
  description: string | null;
  amount: string;
  transaction_date: string;
  account: { id: string; name: string };
  destination_account: { id: string; name: string } | null;
  category: CategoryFixture | null;
  fee_amount: string;
  fee: { id: string; amount: string; account: { id: string; name: string } } | null;
  is_fee: boolean;
  related_transaction_id: string | null;
  version: number;
};

export function transaction(overrides: Partial<TransactionFixture> = {}): TransactionFixture {
  return {
    id: "tttttttt-0000-0000-0000-000000000001",
    type: "expense",
    name: "Groceries",
    description: null,
    amount: "150.00",
    transaction_date: "2026-10-14",
    account: { id: bank.id, name: "Bank" },
    destination_account: null,
    category: categories.food,
    fee_amount: "0.00",
    fee: null,
    is_fee: false,
    related_transaction_id: null,
    version: 1,
    ...overrides,
  };
}
