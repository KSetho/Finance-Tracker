import { ownerRoute } from '../../../../lib/api';
import { getDb } from '../../../../lib/db/client';
import { categoryTypeEnum, type CategoryType } from '../../../../lib/db/schema';
import { json } from '../../../../lib/http';
import { listCategories } from '../../../../lib/services/category';
import { enumValue, query } from '../../../../lib/validation';

export const GET = ownerRoute(
  async ({ request, auth }) => {
    const type = query(
      request.nextUrl.searchParams,
      'type',
      enumValue<CategoryType>(categoryTypeEnum.enumValues),
      null,
    );
    return json(await listCategories(getDb(), auth.userId, type));
  },
  { csrf: false },
);
