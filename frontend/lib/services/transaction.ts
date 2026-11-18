import { getClock } from '../clock';
import { getDb, isIntegrityError } from '../db/client';
import type { CategoryType, Transaction } from '../db/schema';
import { BusinessRuleError, FeeManagedByParent, IdConflict, NotFound, TypeImmutable } from '../errors';
import { dec, ZERO } from '../money';
import * as transactionRepository from '../repositories/transactions';
import type { SortBy, SortOrder, TransactionFilters } from '../repositories/transactions';
import type { ExpenseCreate, IncomeCreate, TransactionUpdate, TransferChanges, TransferUpdate } from '../schemas';
import { requireCategory } from './category';
import { syncFee, updateTransferInTx } from './transfer';
import {
  buildOuts,
  checkVersion,
  type ExpectedFields,
  feeAccountMatches,
  out,
  sameAsRequest,
  type TransactionOut,
  type TransactionPage,
  validateAccounts,
} from './transactionSupport';

// ---- create -------------------------------------------------------------------------------------

async function create(userId: string, data: IncomeCreate | ExpenseCreate): Promise<[TransactionOut, boolean]> {
  const db = getDb();
  const kind = data.kind;
  const fields: ExpectedFields = {
    type: kind,
    name: data.name,
    description: data.description,
    amount: data.amount,
    transactionDate: data.transactionDate,
    accountId: data.accountId,
    categoryId: data.categoryId,
  };
  const feeAmount = data.kind === 'expense' ? data.feeAmount : ZERO;
  const feeAccountId = data.kind === 'expense' ? data.feeAccountId : null;
  const retryFields: ExpectedFields = { ...fields, feeAmount };
  if (data.id !== null) {
    const existing = await transactionRepository.getOwned(db, userId, data.id);
    if (existing !== null) {
      if (sameAsRequest(existing, retryFields) && (await feeAccountMatches(db, existing, feeAccountId))) {
        return [await out(db, userId, existing), false];
      }
      throw new IdConflict();
    }
  }

  let row: Transaction;
  try {
    row = await db.transaction(async (tx) => {
      // Lock every account involved at once, in id order: two payments whose fees hit each
      // other's account would otherwise take the locks in opposite orders and deadlock.
      const involved = new Set([data.accountId]);
      if (feeAmount.greaterThan(0)) involved.add(feeAccountId ?? data.accountId);
      await validateAccounts(tx, userId, involved, data.transactionDate, involved);
      if (data.categoryId !== null) {
        const expected: CategoryType = kind === 'income' ? 'income' : 'expense';
        await requireCategory(tx, userId, data.categoryId, expected);
      }

      const now = getClock().now();
      const created = await transactionRepository.add(tx, {
        id: data.id ?? crypto.randomUUID(),
        userId,
        type: kind,
        name: data.name,
        description: data.description,
        amount: data.amount.toFixed(2),
        transactionDate: data.transactionDate,
        accountId: data.accountId,
        categoryId: data.categoryId,
        createdAt: now,
        updatedAt: now,
      });
      if (feeAmount.greaterThan(0)) {
        await syncFee(tx, userId, created, { feeAmount, feeAccountId });
        await transactionRepository.save(tx, created);
      }
      return created;
    });
    console.info(`transaction_created id=${row.id} type=${kind}`);
  } catch (error) {
    if (!isIntegrityError(error)) throw error;
    // A parallel request with the same id won the race.
    const raced = data.id ? await transactionRepository.getOwned(db, userId, data.id) : null;
    if (raced !== null && sameAsRequest(raced, fields)) return [await out(db, userId, raced), false];
    throw new IdConflict();
  }
  return [await out(db, userId, row), true];
}

export function createIncome(userId: string, data: IncomeCreate): Promise<[TransactionOut, boolean]> {
  return create(userId, data);
}

export function createExpense(userId: string, data: ExpenseCreate): Promise<[TransactionOut, boolean]> {
  return create(userId, data);
}

// ---- read, edit, delete -------------------------------------------------------------------------

export async function getTransaction(userId: string, transactionId: string): Promise<TransactionOut> {
  const db = getDb();
  const row = await transactionRepository.getOwned(db, userId, transactionId);
  if (row === null) throw new NotFound();
  return out(db, userId, row);
}

/** The generic edit endpoint also edits transfers; map its fields onto the transfer ones. */
function asTransferUpdate(data: TransactionUpdate): TransferUpdate {
  const source = data.changes;
  const changes: TransferChanges = {};
  if (source.name !== undefined) changes.name = source.name;
  if ('description' in source) changes.description = source.description ?? null;
  if (source.amount !== undefined) changes.amount = source.amount;
  if (source.transactionDate !== undefined) changes.transactionDate = source.transactionDate;
  if (source.accountId !== undefined) changes.sourceAccountId = source.accountId;
  if (source.feeAmount !== undefined) changes.feeAmount = source.feeAmount;
  if (source.feeAccountId !== undefined) changes.feeAccountId = source.feeAccountId;
  return { version: data.version, changes };
}

export async function updateTransaction(
  userId: string,
  transactionId: string,
  data: TransactionUpdate,
): Promise<TransactionOut> {
  const row = await getDb().transaction(async (tx) => {
    const row = await transactionRepository.getOwned(tx, userId, transactionId, true);
    if (row === null) throw new NotFound();
    if (row.relatedTransactionId !== null) throw new FeeManagedByParent();
    if (data.type !== null && data.type !== row.type) throw new TypeImmutable();
    if (row.type === 'transfer') {
      return updateTransferInTx(tx, userId, transactionId, asTransferUpdate(data));
    }
    checkVersion(row, data.version);

    const { feeAmount: feeAmountChange, feeAccountId: feeAccountChange, ...changes } = data.changes;
    const hasFeeChanges = feeAmountChange !== undefined || feeAccountChange !== undefined;
    const newDate = changes.transactionDate ?? row.transactionDate;
    const newAccount = changes.accountId ?? row.accountId;
    const changedAccounts = new Set<string>(newAccount !== row.accountId ? [newAccount] : []);
    const involved = new Set([newAccount]);
    const finalFee = feeAmountChange ?? dec(row.feeAmount);
    if (row.type === 'expense' && finalFee.greaterThan(0)) {
      // Include the fee's account in the same ordered lock (see create).
      const existingFee = (await transactionRepository.feesForParents(tx, [row.id])).get(row.id);
      const feeAccount = feeAccountChange ?? existingFee?.accountId ?? newAccount;
      involved.add(feeAccount);
      if (existingFee === undefined || existingFee.accountId !== feeAccount) changedAccounts.add(feeAccount);
    }
    await validateAccounts(tx, userId, involved, newDate, changedAccounts);

    if ('categoryId' in changes) {
      const categoryId = changes.categoryId ?? null;
      if (categoryId === null) {
        if (row.type === 'expense') throw new BusinessRuleError('validation_error', 'Choose a category.');
      } else {
        const expected: CategoryType = row.type === 'income' ? 'income' : 'expense';
        await requireCategory(tx, userId, categoryId, expected);
      }
    }

    if (changes.name !== undefined) row.name = changes.name;
    if ('description' in changes) row.description = changes.description ?? null;
    if (changes.amount !== undefined) row.amount = changes.amount.toFixed(2);
    if (changes.transactionDate !== undefined) row.transactionDate = changes.transactionDate;
    if (changes.accountId !== undefined) row.accountId = changes.accountId;
    if ('categoryId' in changes) row.categoryId = changes.categoryId ?? null;
    if (row.type === 'expense' && (hasFeeChanges || dec(row.feeAmount).greaterThan(0))) {
      // A payment's fee follows its parent (date, name) and any change to its own amount/account.
      await syncFee(tx, userId, row, {
        feeAmount: feeAmountChange ?? dec(row.feeAmount),
        feeAccountId: feeAccountChange ?? null,
      });
    }
    row.version += 1;
    row.updatedAt = getClock().now();
    await transactionRepository.save(tx, row);
    return row;
  });
  console.info(row.type === 'transfer' ? `transfer_updated id=${row.id}` : `transaction_updated id=${row.id}`);
  return out(getDb(), userId, row);
}

export async function deleteTransaction(userId: string, transactionId: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    const row = await transactionRepository.getOwned(tx, userId, transactionId, true);
    if (row === null) throw new NotFound();
    if (row.relatedTransactionId !== null) throw new FeeManagedByParent();
    await transactionRepository.remove(tx, row); // a linked fee goes with it (ON DELETE CASCADE)
  });
  console.info(`transaction_deleted id=${transactionId}`);
}

export async function listTransactions(
  userId: string,
  filters: TransactionFilters,
  sortBy: SortBy,
  sortOrder: SortOrder,
  page: number,
  pageSize: number,
): Promise<TransactionPage> {
  if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) {
    throw new BusinessRuleError('validation_error', 'The start date is after the end date.');
  }
  const db = getDb();
  const rows = await transactionRepository.listPage(db, userId, filters, sortBy, sortOrder, page, pageSize);
  return {
    items: await buildOuts(db, userId, rows),
    page,
    page_size: pageSize,
    total: await transactionRepository.count(db, userId, filters),
  };
}
