import { ownerRoute } from '../../../../lib/api';
import { json } from '../../../../lib/http';
import { listMonths } from '../../../../lib/services/budget';
import { query, str } from '../../../../lib/validation';

export const GET = ownerRoute(async ({ request, auth }) => {
  const params = request.nextUrl.searchParams;
  const first = query(params, 'from', str({ max: 7 }), null);
  const last = query(params, 'to', str({ max: 7 }), null);
  return json(await listMonths(auth.userId, first, last));
});
