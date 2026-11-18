import type { Executor } from '../db/client';
import type { Category, CategoryType } from '../db/schema';
import { BusinessRuleError, NotFound } from '../errors';
import * as categoryRepository from '../repositories/categories';

export const DEFAULT_CATEGORIES: ReadonlyArray<readonly [string, CategoryType]> = [
  ['Salary', 'income'],
  ['Freelance', 'income'],
  ['Business', 'income'],
  ['Gift', 'income'],
  ['Other income', 'income'],
  ['Food', 'expense'],
  ['Transport', 'expense'],
  ['Bills', 'expense'],
  ['Shopping', 'expense'],
  ['Health', 'expense'],
  ['Family', 'expense'],
  ['Fees', 'expense'],
  ['Other expense', 'expense'],
];

export interface CategoryOut {
  id: string;
  name: string;
  category_type: CategoryType;
  is_system: boolean;
}

export function categoryOut(category: Category): CategoryOut {
  return {
    id: category.id,
    name: category.name,
    category_type: category.categoryType,
    is_system: category.isSystem,
  };
}

/** Create the built-in categories for an owner. Safe to call repeatedly; caller owns the transaction. */
export async function seedDefaults(db: Executor, userId: string): Promise<void> {
  await categoryRepository.insertMissing(db, userId, DEFAULT_CATEGORIES);
}

export async function listCategories(
  db: Executor,
  userId: string,
  categoryType: CategoryType | null,
): Promise<{ items: CategoryOut[] }> {
  const rows = await categoryRepository.listForUser(db, userId, categoryType);
  return { items: rows.map(categoryOut) };
}

/** The owner's category of the expected type, or NotFound / a business-rule error. */
export async function requireCategory(
  db: Executor,
  userId: string,
  categoryId: string,
  expected: CategoryType,
): Promise<Category> {
  const category = await categoryRepository.getOwned(db, userId, categoryId);
  if (category === null) throw new NotFound();
  if (category.categoryType !== expected) {
    throw new BusinessRuleError('category_type_mismatch', `Choose an ${expected} category.`);
  }
  return category;
}
