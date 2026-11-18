/** Helpers shared by the transaction and transfer services (backend/app/services/transaction_support.py). */
import { isoDateTime } from '../dates';
import type { Executor } from '../db/client';
import type { Account, Transaction, TransactionType } from '../db/schema';
import { BusinessRuleError, NotFound, StaleVersion } from '../errors';
import { type Decimal, dec, formatMoney } from '../money';
import * as accountRepository from '../repositories/accounts';
import * as categoryRepository from '../repositories/categories';
import * as transactionRepository from '../repositories/transactions';
import { type CategoryOut, categoryOut } from './category';

export interface AccountRef {
  id: string;
  name: string;
}

export interface FeeRef {
  id: string;
  amount: string;
  account: AccountRef;
}

export interface TransactionOut {
  id: string;
  type: TransactionType;
  name: string;
  description: string | null;
  amount: string;
  transaction_date: string;
  account: AccountRef;
  destination_account: AccountRef | null;
  category: CategoryOut | null;
  fee_amount: string;
  fee: FeeRef | null;
  is_fee: boolean;
  related_transaction_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface TransactionPage {
  items: TransactionOut[];
  page: number;
  page_size: number;
  total: number;
}

/** Build API objects from transactions with three batched lookups. */
export async function buildOuts(db: Executor, userId: string, rows: Transaction[]): Promise<TransactionOut[]> {
  const fees = await transactionRepository.feesForParents(
    db,
    rows.filter((row) => row.relatedTransactionId === null).map((row) => row.id),
  );
  const accountIds = new Set<string>(rows.map((row) => row.accountId));
  for (const fee of fees.values()) accountIds.add(fee.accountId);
  for (const row of rows) if (row.destinationAccountId) accountIds.add(row.destinationAccountId);
  const accounts = await accountRepository.getManyOwned(db, userId, accountIds);
  const categories = await categoryRepository.getMany(
    db,
    userId,
    rows.flatMap((row) => (row.categoryId ? [row.categoryId] : [])),
  );

  const ref = (accountId: string): AccountRef => ({ id: accountId, name: accounts.get(accountId)!.name });

  return rows.map((row) => {
    const fee = fees.get(row.id);
    const category = row.categoryId ? categories.get(row.categoryId) : undefined;
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      description: row.description,
      amount: formatMoney(row.amount),
      transaction_date: row.transactionDate,
      account: ref(row.accountId),
      destination_account: row.destinationAccountId ? ref(row.destinationAccountId) : null,
      category: category ? categoryOut(category) : null,
      fee_amount: formatMoney(row.feeAmount),
      fee: fee ? { id: fee.id, amount: formatMoney(fee.amount), account: ref(fee.accountId) } : null,
      is_fee: row.relatedTransactionId !== null,
      related_transaction_id: row.relatedTransactionId,
      version: row.version,
      created_at: isoDateTime(row.createdAt),
      updated_at: isoDateTime(row.updatedAt),
    };
  });
}

export async function out(db: Executor, userId: string, row: Transaction): Promise<TransactionOut> {
  return (await buildOuts(db, userId, [row]))[0];
}

/** Every account must be the owner's, not archived (unless the reference is unchanged) and open
 * on the transaction date. The accounts are locked so they cannot change underneath the write. */
export async function validateAccounts(
  db: Executor,
  userId: string,
  accountIds: Set<string>,
  onDate: string,
  changed: Set<string>,
): Promise<Map<string, Account>> {
  const accounts = await accountRepository.getManyOwned(db, userId, accountIds, true);
  for (const accountId of accountIds) {
    const account = accounts.get(accountId);
    if (account === undefined) throw new NotFound();
    if (account.isArchived && changed.has(accountId)) {
      throw new BusinessRuleError('account_archived', `${account.name} is archived. Choose another account.`);
    }
    if (onDate < account.openingDate) {
      throw new BusinessRuleError(
        'before_opening_date',
        `${account.name} was opened on ${account.openingDate}. Choose a later date.`,
      );
    }
  }
  return accounts;
}

export function checkVersion(row: Transaction, version: number): void {
  if (row.version !== version) throw new StaleVersion();
}

export type ExpectedFields = Partial<{
  type: TransactionType;
  name: string;
  description: string | null;
  amount: Decimal;
  transactionDate: string;
  accountId: string;
  destinationAccountId: string | null;
  categoryId: string | null;
  feeAmount: Decimal;
}>;

export function sameAsRequest(existing: Transaction, expected: ExpectedFields): boolean {
  return (Object.keys(expected) as (keyof ExpectedFields)[]).every((field) => {
    const value = expected[field];
    if (field === 'amount' || field === 'feeAmount') {
      return dec(existing[field]).equals(value as Decimal);
    }
    return existing[field] === value;
  });
}

/** Whether an existing parent's fee is charged to the requested account (null = any). */
export async function feeAccountMatches(
  db: Executor,
  existing: Transaction,
  feeAccountId: string | null,
): Promise<boolean> {
  if (feeAccountId === null || dec(existing.feeAmount).lessThanOrEqualTo(0)) return true;
  const fee = (await transactionRepository.feesForParents(db, [existing.id])).get(existing.id);
  return fee !== undefined && fee.accountId === feeAccountId;
}
