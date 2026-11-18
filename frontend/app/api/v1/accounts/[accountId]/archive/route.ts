import { ownerRoute } from '../../../../../../lib/api';
import { json } from '../../../../../../lib/http';
import { archiveAccount } from '../../../../../../lib/services/account';
import { uuidValue } from '../../../../../../lib/validation';

export const POST = ownerRoute<{ accountId: string }>(async ({ params, auth }) => {
  return json(await archiveAccount(auth.userId, uuidValue(params.accountId)));
});
