import { after } from 'next/server';

import { publicRoute } from '../../../../../lib/api';
import { clientIp } from '../../../../../lib/clientIp';
import { getSettings } from '../../../../../lib/config';
import { makeEmailSender } from '../../../../../lib/email';
import { json, readJsonObject } from '../../../../../lib/http';
import { parseForgotPassword } from '../../../../../lib/schemas';
import { requestPasswordReset } from '../../../../../lib/services/auth';

const RESET_REQUEST_MESSAGE = 'If the account exists, a password reset link has been sent.';

export const POST = publicRoute(async ({ request }) => {
  const settings = getSettings();
  const payload = parseForgotPassword(await readJsonObject(request));
  const sourceIp = clientIp(request, settings);
  // Respond before any SMTP work so delivery/account state cannot be inferred from latency.
  after(async () => {
    try {
      await requestPasswordReset(settings, makeEmailSender(settings), { email: payload.email, sourceIp });
    } catch (error) {
      console.error('password_reset_background_failed', error);
    }
  });
  return json({ message: RESET_REQUEST_MESSAGE }, 202);
});
