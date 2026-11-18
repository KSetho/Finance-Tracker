import { publicRoute } from '../../../../../lib/api';
import { setSessionCookie } from '../../../../../lib/auth/session';
import { clientIp } from '../../../../../lib/clientIp';
import { getSettings } from '../../../../../lib/config';
import { isoDateTime } from '../../../../../lib/dates';
import { json, readJsonObject } from '../../../../../lib/http';
import { parseLogin } from '../../../../../lib/schemas';
import { login } from '../../../../../lib/services/auth';

export const POST = publicRoute(async ({ request }) => {
  const settings = getSettings();
  const payload = parseLogin(await readJsonObject(request));
  const result = await login(settings, {
    email: payload.email,
    password: payload.password,
    sourceIp: clientIp(request, settings),
  });
  const response = json({
    user: { id: result.user.id, email: result.user.email },
    csrf_token: result.csrfToken,
    expires_at: isoDateTime(result.expiresAt),
  });
  setSessionCookie(response, settings, result.token, result.maxAgeSeconds);
  return response;
});
