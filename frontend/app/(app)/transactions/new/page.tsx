import { Suspense } from "react";
import { NewTransactionPage } from "../../../../src/views/NewTransactionPage";

export default function Page() {
  return (
    <Suspense>
      <NewTransactionPage />
    </Suspense>
  );
}
