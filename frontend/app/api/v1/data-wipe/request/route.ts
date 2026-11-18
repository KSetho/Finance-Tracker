import { ownerRoute } from '../../../../../lib/api';
import { clientIp } from '../../../../../lib/clientIp';
import { getSettings } from '../../../../../lib/config';
import { makeEmailSender } from '../../../../../lib/email';
import { json } from '../../../../../lib/http';
import { requestWipe } from '../../../../../lib/services/dataWipe';

export const POST = ownerRoute(async ({ request, auth }) => {
  const settings = getSettings();
  const result = await requestWipe(settings, makeEmailSender(settings), auth, {
    sourceIp: clientIp(request, settings),
  });
  return json(result, 202);
});
