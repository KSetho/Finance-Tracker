import type { ReactNode } from "react";
import { RequireAuth } from "../../src/auth/RequireAuth";
import { Layout } from "../../src/components/Layout";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <Layout>{children}</Layout>
    </RequireAuth>
  );
}
