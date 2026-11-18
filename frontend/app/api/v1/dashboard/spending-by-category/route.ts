import { ownerRoute } from '../../../../../lib/api';
import { json } from '../../../../../lib/http';
import { spendingByCategory } from '../../../../../lib/services/dashboard';
import { dateValue, query, str } from '../../../../../lib/validation';

export const GET = ownerRoute(
  async ({ request, auth }) => {
    const params = request.nextUrl.searchParams;
    const month = query(params, 'month', str({ max: 7 }), null);
    const startDate = query(params, 'start_date', dateValue, null);
    const endDate = query(params, 'end_date', dateValue, null);
    return json(await spendingByCategory(auth.userId, month, startDate, endDate));
  },
  { csrf: false },
);
