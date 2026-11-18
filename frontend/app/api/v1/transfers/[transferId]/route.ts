import { ownerRoute } from '../../../../../lib/api';
import { json, noContent, readJsonObject } from '../../../../../lib/http';
import { parseTransferUpdate } from '../../../../../lib/schemas';
import { deleteTransfer, getTransfer, updateTransfer } from '../../../../../lib/services/transfer';
import { uuidValue } from '../../../../../lib/validation';

type Params = { transferId: string };

export const GET = ownerRoute<Params>(async ({ params, auth }) => {
  return json(await getTransfer(auth.userId, uuidValue(params.transferId)));
});

export const PATCH = ownerRoute<Params>(async ({ request, params, auth }) => {
  const transferId = uuidValue(params.transferId);
  const payload = parseTransferUpdate(await readJsonObject(request));
  return json(await updateTransfer(auth.userId, transferId, payload));
});

export const DELETE = ownerRoute<Params>(async ({ params, auth }) => {
  await deleteTransfer(auth.userId, uuidValue(params.transferId));
  return noContent();
});
