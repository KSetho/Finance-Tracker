import { ownerRoute } from '../../../../../lib/api';
import { json } from '../../../../../lib/http';
import { cashFlow } from '../../../../../lib/services/dashboard';
import { dateValue, query, requiredQuery, uuidValue } from '../../../../../lib/validation';

export const GET = ownerRoute(
  async ({ request, auth }) => {
    const params = request.nextUrl.searchParams;
    const startDate = requiredQuery(params, 'start_date', dateValue);
    const endDate = requiredQuery(params, 'end_date', dateValue);
    const categoryId = query(params, 'category_id', uuidValue, null);
    return json(await cashFlow(auth.userId, startDate, endDate, categoryId));
  },
  { csrf: false },
);
