import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { useEffect, useState, type ReactNode } from "react";
import { AuthProvider } from "../src/auth/AuthProvider";
import { RequireAuth } from "../src/auth/RequireAuth";
import { Layout } from "../src/components/Layout";
import { AccountFormPage } from "../src/views/AccountFormPage";
import { AccountsPage } from "../src/views/AccountsPage";
import { BudgetPage } from "../src/views/BudgetPage";
import { CalendarPage } from "../src/views/CalendarPage";
import { DashboardPage } from "../src/views/DashboardPage";
import { ForgotPasswordPage } from "../src/views/ForgotPasswordPage";
import { LoginPage } from "../src/views/LoginPage";
import { NewTransactionPage } from "../src/views/NewTransactionPage";
import { ResetPasswordPage } from "../src/views/ResetPasswordPage";
import { SettingsPage } from "../src/views/SettingsPage";
import { TransactionDetailPage } from "../src/views/TransactionDetailPage";
import { TransactionsPage } from "../src/views/TransactionsPage";
import { nav, pushMock, replaceMock, setNav, subscribeNav } from "./next-nav";

function matchRoute(pathname: string): { authed: boolean; node: ReactNode } {
  if (pathname === "/login") return { authed: false, node: <LoginPage /> };
  if (pathname === "/forgot-password") return { authed: false, node: <ForgotPasswordPage /> };
  if (pathname === "/reset-password") return { authed: false, node: <ResetPasswordPage /> };
  if (pathname === "/dashboard") return { authed: true, node: <DashboardPage /> };
  if (pathname === "/transactions") return { authed: true, node: <TransactionsPage /> };
  if (pathname === "/transactions/new") return { authed: true, node: <NewTransactionPage /> };
  if (pathname.startsWith("/transactions/")) return { authed: true, node: <TransactionDetailPage /> };
  if (pathname === "/accounts") return { authed: true, node: <AccountsPage /> };
  if (pathname === "/accounts/new") return { authed: true, node: <AccountFormPage /> };
  if (pathname.match(/^\/accounts\/[^/]+\/edit$/)) return { authed: true, node: <AccountFormPage /> };
  if (pathname === "/budget") return { authed: true, node: <BudgetPage /> };
  if (pathname === "/calendar") return { authed: true, node: <CalendarPage /> };
  if (pathname === "/settings") return { authed: true, node: <SettingsPage /> };
  return { authed: true, node: <DashboardPage /> };
}

function RouterHarness() {
  const [, setTick] = useState(0);
  useEffect(() => subscribeNav(() => setTick((n) => n + 1)), []);
  const route = matchRoute(nav.pathname);
  if (!route.authed) return <>{route.node}</>;
  return (
    <RequireAuth>
      <Layout>{route.node}</Layout>
    </RequireAuth>
  );
}

export function renderApp(path: string) {
  setNav(path);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const result = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterHarness />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient, replaceMock, pushMock };
}
