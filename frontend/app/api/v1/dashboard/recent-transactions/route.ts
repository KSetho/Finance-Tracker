import { ownerRoute } from '../../../../../lib/api';
import { json } from '../../../../../lib/http';
import { recentTransactions } from '../../../../../lib/services/dashboard';
import { bounded, query } from '../../../../../lib/validation';

export const GET = ownerRoute(
  async ({ request, auth }) => {
    const limit = query(request.nextUrl.searchParams, 'limit', bounded(1, 50), 10);
    return json(await recentTransactions(auth.userId, limit));
  },
  { csrf: false },
);
