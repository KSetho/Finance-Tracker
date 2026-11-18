import { ownerRoute } from '../../../../../lib/api';
import { json } from '../../../../../lib/http';
import { summary } from '../../../../../lib/services/dashboard';
import { query, str } from '../../../../../lib/validation';

export const GET = ownerRoute(
  async ({ request, auth }) => {
    const month = query(request.nextUrl.searchParams, 'month', str({ max: 7 }), null);
    return json(await summary(auth.userId, month));
  },
  { csrf: false },
);
