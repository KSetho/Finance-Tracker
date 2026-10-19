import { useCallback, useState } from "react";

/**
 * A client-generated id for a create form. The same id is sent on every retry of that form, so a
 * double tap or a dropped connection cannot create a duplicate; call reset() after success.
 */
export function useIdempotentId() {
  const [id, setId] = useState(() => crypto.randomUUID());
  const reset = useCallback(() => setId(crypto.randomUUID()), []);
  return { id, reset };
}
