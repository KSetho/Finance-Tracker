import { ownerRoute } from '../../../../../lib/api';
import { json, readJsonObject } from '../../../../../lib/http';
import { parseExpenseCreate } from '../../../../../lib/schemas';
import { createExpense } from '../../../../../lib/services/transaction';

export const POST = ownerRoute(async ({ request, auth }) => {
  const payload = parseExpenseCreate(await readJsonObject(request));
  const [transaction, created] = await createExpense(auth.userId, payload);
  return json(transaction, created ? 201 : 200);
});
