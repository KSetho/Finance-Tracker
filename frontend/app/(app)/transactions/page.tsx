import { Suspense } from "react";
import { TransactionsPage } from "../../../src/views/TransactionsPage";

export default function Page() {
  return (
    <Suspense>
      <TransactionsPage />
    </Suspense>
  );
}
