import { Link } from "react-router-dom";
import { ACCOUNT_TYPE_LABELS, type Account } from "../api/accounts";
import { formatGhs } from "../lib/money";

export function AccountCard({ account }: { account: Account }) {
  return (
    <Link to={`/accounts/${account.id}/edit`} className="account-card">
      <span className="account-main">
        <span className="account-name">{account.name}</span>
        <span className="account-type">{ACCOUNT_TYPE_LABELS[account.account_type]}</span>
      </span>
      <span className="account-side">
        <span className="account-balance">{formatGhs(account.balance)}</span>
        {account.is_archived ? <span className="badge">Archived</span> : null}
      </span>
    </Link>
  );
}
