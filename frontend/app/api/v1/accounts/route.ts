import { ownerRoute } from '../../../../lib/api';
import { json, readJsonObject } from '../../../../lib/http';
import { parseAccountCreate } from '../../../../lib/schemas';
import { createAccount, listAccounts } from '../../../../lib/services/account';
import { boolValue, query } from '../../../../lib/validation';

export const GET = ownerRoute(async ({ request, auth }) => {
  const includeArchived = query(request.nextUrl.searchParams, 'include_archived', boolValue, false);
  return json(await listAccounts(auth.userId, includeArchived));
});

export const POST = ownerRoute(async ({ request, auth }) => {
  const payload = parseAccountCreate(await readJsonObject(request));
  const [account, created] = await createAccount(auth.userId, payload);
  return json(account, created ? 201 : 200);
});
