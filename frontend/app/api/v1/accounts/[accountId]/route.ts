import { ownerRoute } from '../../../../../lib/api';
import { json, readJsonObject } from '../../../../../lib/http';
import { parseAccountUpdate } from '../../../../../lib/schemas';
import { getAccount, updateAccount } from '../../../../../lib/services/account';
import { uuidValue } from '../../../../../lib/validation';

type Params = { accountId: string };

export const GET = ownerRoute<Params>(async ({ params, auth }) => {
  return json(await getAccount(auth.userId, uuidValue(params.accountId)));
});

export const PATCH = ownerRoute<Params>(async ({ request, params, auth }) => {
  const accountId = uuidValue(params.accountId);
  const changes = parseAccountUpdate(await readJsonObject(request));
  return json(await updateAccount(auth.userId, accountId, changes));
});
