import { ownerRoute } from '../../../../lib/api';
import { json, readJsonObject } from '../../../../lib/http';
import { parseTransferCreate } from '../../../../lib/schemas';
import { createTransfer } from '../../../../lib/services/transfer';

export const POST = ownerRoute(async ({ request, auth }) => {
  const payload = parseTransferCreate(await readJsonObject(request));
  const [transfer, created] = await createTransfer(auth.userId, payload);
  return json(transfer, created ? 201 : 200);
});
