import { ownerRoute } from '../../../../../lib/api';
import { json, readJsonObject } from '../../../../../lib/http';
import { parseIncomeCreate } from '../../../../../lib/schemas';
import { createIncome } from '../../../../../lib/services/transaction';

export const POST = ownerRoute(async ({ request, auth }) => {
  const payload = parseIncomeCreate(await readJsonObject(request));
  const [transaction, created] = await createIncome(auth.userId, payload);
  return json(transaction, created ? 201 : 200);
});
