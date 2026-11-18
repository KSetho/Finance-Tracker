import { ownerRoute } from '../../../../lib/api';
import { transactionTypeEnum, type TransactionType } from '../../../../lib/db/schema';
import { json } from '../../../../lib/http';
import type { SortBy, SortOrder } from '../../../../lib/repositories/transactions';
import { listTransactions } from '../../../../lib/services/transaction';
import { bounded, dateValue, enumValue, query, str, uuidValue } from '../../../../lib/validation';

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 100;

export const GET = ownerRoute(async ({ request, auth }) => {
  const params = request.nextUrl.searchParams;
  const startDate = query(params, 'start_date', dateValue, null);
  const endDate = query(params, 'end_date', dateValue, null);
  const type = query(params, 'type', enumValue<TransactionType>(transactionTypeEnum.enumValues), null);
  const categoryId = query(params, 'category_id', uuidValue, null);
  const accountId = query(params, 'account_id', uuidValue, null);
  const q = query(params, 'q', str({ max: 120 }), null);
  const sortBy = query(params, 'sort_by', enumValue<SortBy>(['transaction_date', 'amount']), 'transaction_date');
  const sortOrder = query(params, 'sort_order', enumValue<SortOrder>(['asc', 'desc']), 'desc');
  const page = query(params, 'page', bounded(1, Number.MAX_SAFE_INTEGER), 1);
  const pageSize = query(params, 'page_size', bounded(1, PAGE_SIZE_MAX), PAGE_SIZE_DEFAULT);

  const result = await listTransactions(
    auth.userId,
    { startDate, endDate, type, categoryId, accountId, q: q || null },
    sortBy,
    sortOrder,
    page,
    pageSize,
  );
  return json(result);
});
