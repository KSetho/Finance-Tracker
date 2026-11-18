import { ownerRoute } from '../../../../../lib/api';
import { json, noContent, readJsonObject } from '../../../../../lib/http';
import { parseTransactionUpdate } from '../../../../../lib/schemas';
import { deleteTransaction, getTransaction, updateTransaction } from '../../../../../lib/services/transaction';
import { uuidValue } from '../../../../../lib/validation';

type Params = { transactionId: string };

export const GET = ownerRoute<Params>(async ({ params, auth }) => {
  return json(await getTransaction(auth.userId, uuidValue(params.transactionId)));
});

export const PATCH = ownerRoute<Params>(async ({ request, params, auth }) => {
  const transactionId = uuidValue(params.transactionId);
  const payload = parseTransactionUpdate(await readJsonObject(request));
  return json(await updateTransaction(auth.userId, transactionId, payload));
});

export const DELETE = ownerRoute<Params>(async ({ params, auth }) => {
  await deleteTransaction(auth.userId, uuidValue(params.transactionId));
  return noContent();
});
