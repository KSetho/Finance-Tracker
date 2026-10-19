import { useCallback, useState } from "react";

const KEY = "finance.lastAccountId";

/** Remembers the account used for the latest saved entry so the Add form can preselect it. */
export function useLastAccount() {
  const [lastAccountId, setLastAccountId] = useState<string | null>(() => localStorage.getItem(KEY));
  const remember = useCallback((accountId: string) => {
    localStorage.setItem(KEY, accountId);
    setLastAccountId(accountId);
  }, []);
  return { lastAccountId, remember };
}
