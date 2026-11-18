import { ownerRoute } from '../../../../../../lib/api';
import { makeDate } from '../../../../../../lib/dates';
import { getDb } from '../../../../../../lib/db/client';
import { json, readJsonObject } from '../../../../../../lib/http';
import { parseBudgetUpdate } from '../../../../../../lib/schemas';
import { getMonth, setAllowance } from '../../../../../../lib/services/budget';
import { bounded } from '../../../../../../lib/validation';

type Params = { year: string; month: string };

function monthStart(params: Params): string {
  return makeDate(bounded(2000, 2100)(params.year), bounded(1, 12)(params.month), 1);
}

export const GET = ownerRoute<Params>(async ({ params, auth }) => {
  return json(await getMonth(getDb(), auth.userId, monthStart(params)));
});

export const PUT = ownerRoute<Params>(async ({ request, params, auth }) => {
  const start = monthStart(params);
  const payload = parseBudgetUpdate(await readJsonObject(request));
  return json(await setAllowance(auth.userId, start, payload.allowance));
});
