import { Link } from "react-router-dom";
import type { Transaction } from "../api/transactions";
import { formatDate } from "../lib/dates";
import { formatGhs } from "../lib/money";

const TYPE_LABEL = { income: "Income", expense: "Expense", transfer: "Transfer" } as const;

/** "+GH₵ 500.00" for income, "-GH₵ 150.00" for expenses, no sign for transfers (neutral). */
export function signedAmount(transaction: Transaction): string {
  const amount = formatGhs(transaction.amount);
  if (transaction.type === "income") return `+${amount}`;
  if (transaction.type === "expense") return `-${amount}`;
  return amount;
}

/** Fee rows are named "Fee: <parent>"; show them as "Fee for <parent>". */
export function displayName(transaction: Transaction): string {
  if (!transaction.is_fee) return transaction.name;
  return transaction.name.startsWith("Fee: ")
    ? `Fee for ${transaction.name.slice(5)}`
    : transaction.name;
}

function meta(transaction: Transaction): string {
  const where =
    transaction.type === "transfer" && transaction.destination_account
      ? `${transaction.account.name} → ${transaction.destination_account.name}`
      : transaction.account.name;
  return [
    transaction.is_fee ? "Fee" : TYPE_LABEL[transaction.type],
    formatDate(transaction.transaction_date),
    where,
    transaction.category?.name,
    transaction.type === "transfer" && transaction.fee
      ? `Fee ${formatGhs(transaction.fee.amount)}`
      : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function TransactionRow({ transaction }: { transaction: Transaction }) {
  return (
    <Link to={`/transactions/${transaction.id}`} className="tx-row">
      <span className="tx-main">
        <span className="tx-name">{displayName(transaction)}</span>
        <span className="tx-meta">{meta(transaction)}</span>
      </span>
      <span className={`tx-amount tx-${transaction.type}`}>{signedAmount(transaction)}</span>
    </Link>
  );
}
