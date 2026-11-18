import { ownerRoute } from '../../../../../lib/api';
import { getSettings } from '../../../../../lib/config';
import { noContent, readJsonObject } from '../../../../../lib/http';
import { parseDataWipeConfirm } from '../../../../../lib/schemas';
import { confirmWipe } from '../../../../../lib/services/dataWipe';

export const POST = ownerRoute(async ({ request, auth }) => {
  const payload = parseDataWipeConfirm(await readJsonObject(request));
  await confirmWipe(getSettings(), auth, payload);
  return noContent();
});
