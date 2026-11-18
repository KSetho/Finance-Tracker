import { publicRoute } from '../../../../../lib/api';
import { getSettings } from '../../../../../lib/config';
import { noContent, readJsonObject } from '../../../../../lib/http';
import { parseResetPassword } from '../../../../../lib/schemas';
import { resetPasswordWithToken } from '../../../../../lib/services/auth';

export const POST = publicRoute(async ({ request }) => {
  const payload = parseResetPassword(await readJsonObject(request));
  await resetPasswordWithToken(getSettings(), payload);
  return noContent();
});
