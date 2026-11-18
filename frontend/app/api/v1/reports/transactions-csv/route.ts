import { ownerRoute } from '../../../../../lib/api';
import { clientIp } from '../../../../../lib/clientIp';
import { getSettings } from '../../../../../lib/config';
import { makeEmailSender } from '../../../../../lib/email';
import { json, readJsonObject } from '../../../../../lib/http';
import { parseTransactionCsvReport } from '../../../../../lib/schemas';
import { emailTransactionsCsv } from '../../../../../lib/services/report';

export const POST = ownerRoute(async ({ request, auth }) => {
  const settings = getSettings();
  const payload = parseTransactionCsvReport(await readJsonObject(request));
  const result = await emailTransactionsCsv(settings, makeEmailSender(settings), auth, {
    startDate: payload.startDate,
    endDate: payload.endDate,
    sourceIp: clientIp(request, settings),
  });
  return json(result, 202);
});
