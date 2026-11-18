import { ownerRoute } from '../../../../../lib/api';
import { json } from '../../../../../lib/http';
import { transactionCalendar } from '../../../../../lib/services/dashboard';
import { requiredQuery, str } from '../../../../../lib/validation';

export const GET = ownerRoute(
  async ({ request, auth }) => {
    const month = requiredQuery(request.nextUrl.searchParams, 'month', str({ max: 7 }));
    return json(await transactionCalendar(auth.userId, month));
  },
  { csrf: false },
);
