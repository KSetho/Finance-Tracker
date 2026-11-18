/**
 * Transfers between the owner's accounts, and the one rule that makes fees safe
 * (port of backend/app/services/transfer_service.py).
 *
 * A fee is a separate expense row linked to its parent (a transfer, or an expense paid to another
 * person). `syncFee` is the only code that creates, changes or removes it, so a parent and its fee
 * always change together, in the caller's single database transaction, and the parent's
 * `fee_amount` is only ever an input - never a figure that gets summed.
 */
import { createHash } from 'node:crypto';

import { getClock } from '../clock';
import { type Executor, getDb, isIntegrityError, type Tx } from '../db/client';
import type { Transaction } from '../db/schema';
import { BusinessRuleError, IdConflict, NotFound } from '../errors';
import { type Decimal, dec, ZERO } from '../money';
import * as categoryRepository from '../repositories/categories';
import * as transactionRepository from '../repositories/transactions';
import type { TransferChanges, TransferCreate, TransferUpdate } from '../schemas';
import {
  checkVersion,
  type ExpectedFields,
  feeAccountMatches,
  out,
  sameAsRequest,
  type TransactionOut,
  validateAccounts,
} from './transactionSupport';

const FEE_PREFIX = 'Fee: ';

/** RFC 4122 name-based UUID (SHA-1), identical to Python's uuid.uuid5. */
export function uuid5(namespace: string, name: string): string {
  const bytes = createHash('sha1')
    .update(Buffer.from(namespace.replace(/-/g, ''), 'hex'))
    .update(name, 'utf8')
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Deterministic id of a parent's fee row, so a retry can never produce a second one. */
export function feeIdFor(parentId: string): string {
  return uuid5(parentId, 'fee');
}

function feeName(parentName: string): string {
  return [...`${FEE_PREFIX}${parentName}`].slice(0, 120).join('');
}

/**
 * Make the parent's linked fee match `feeAmount`: create, update or delete the single row.
 *
 * The fee takes the parent's date and name, is charged to `feeAccountId` (else the account it
 * already used, else the parent's account) and sits in the Fees category. Sets
 * `parent.feeAmount` in memory; the caller persists the parent.
 */
export async function syncFee(
  db: Executor,
  userId: string,
  parent: Transaction,
  { feeAmount, feeAccountId }: { feeAmount: Decimal; feeAccountId: string | null },
): Promise<void> {
  const existing = (await transactionRepository.feesForParents(db, [parent.id])).get(parent.id);

  if (feeAmount.lessThanOrEqualTo(0)) {
    if (existing !== undefined) await transactionRepository.remove(db, existing);
    parent.feeAmount = ZERO.toFixed(2);
    return;
  }

  const accountId = feeAccountId ?? existing?.accountId ?? parent.accountId;
  const unchanged = existing !== undefined && existing.accountId === accountId;
  await validateAccounts(
    db,
    userId,
    new Set([accountId]),
    parent.transactionDate,
    unchanged ? new Set() : new Set([accountId]),
  );

  const now = getClock().now();
  if (existing === undefined) {
    const feesCategory = await categoryRepository.getFeesCategory(db, userId);
    if (feesCategory === null) {
      // Cannot happen for a provisioned owner.
      throw new BusinessRuleError('validation_error', 'The Fees category is missing.');
    }
    await transactionRepository.add(db, {
      id: feeIdFor(parent.id),
      userId,
      type: 'expense',
      name: feeName(parent.name),
      amount: feeAmount.toFixed(2),
      transactionDate: parent.transactionDate,
      accountId,
      categoryId: feesCategory.id,
      relatedTransactionId: parent.id,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    existing.name = feeName(parent.name);
    existing.amount = feeAmount.toFixed(2);
    existing.accountId = accountId;
    existing.transactionDate = parent.transactionDate;
    existing.updatedAt = now;
    existing.version += 1;
    await transactionRepository.save(db, existing);
  }
  parent.feeAmount = feeAmount.toFixed(2);
}

function requireTransfer(row: Transaction | null): Transaction {
  if (row === null || row.type !== 'transfer' || row.relatedTransactionId) throw new NotFound();
  return row;
}

function checkTransferFeeAccount(source: string, destination: string, feeAccount: string): void {
  if (feeAccount !== source && feeAccount !== destination) {
    throw new BusinessRuleError(
      'validation_error',
      'The fee must be charged to the source or the destination account.',
    );
  }
}

function checkDistinct(source: string, destination: string): void {
  if (source === destination) throw new BusinessRuleError('same_account', 'Choose two different accounts.');
}

export async function createTransfer(userId: string, data: TransferCreate): Promise<[TransactionOut, boolean]> {
  const db = getDb();
  const fields: ExpectedFields = {
    type: 'transfer',
    name: data.name,
    description: data.description,
    amount: data.amount,
    transactionDate: data.transactionDate,
    accountId: data.sourceAccountId,
    destinationAccountId: data.destinationAccountId,
    feeAmount: data.feeAmount,
  };
  if (data.id !== null) {
    const existing = await transactionRepository.getOwned(db, userId, data.id);
    if (existing !== null) {
      if (sameAsRequest(existing, fields) && (await feeAccountMatches(db, existing, data.feeAccountId))) {
        return [await out(db, userId, existing), false];
      }
      throw new IdConflict();
    }
  }

  checkDistinct(data.sourceAccountId, data.destinationAccountId);
  let row: Transaction;
  try {
    row = await db.transaction(async (tx) => {
      const both = new Set([data.sourceAccountId, data.destinationAccountId]);
      await validateAccounts(tx, userId, both, data.transactionDate, both);
      const feeAccount = data.feeAccountId ?? data.sourceAccountId;
      if (data.feeAmount.greaterThan(0)) {
        checkTransferFeeAccount(data.sourceAccountId, data.destinationAccountId, feeAccount);
      }

      const now = getClock().now();
      const created = await transactionRepository.add(tx, {
        id: data.id ?? crypto.randomUUID(),
        userId,
        type: 'transfer',
        name: data.name,
        description: data.description,
        amount: data.amount.toFixed(2),
        transactionDate: data.transactionDate,
        accountId: data.sourceAccountId,
        destinationAccountId: data.destinationAccountId,
        feeAmount: data.feeAmount.toFixed(2),
        createdAt: now,
        updatedAt: now,
      });
      await syncFee(tx, userId, created, { feeAmount: data.feeAmount, feeAccountId: feeAccount });
      await transactionRepository.save(tx, created);
      return created;
    });
    console.info(`transfer_created id=${row.id}`);
  } catch (error) {
    if (!isIntegrityError(error)) throw error;
    // A parallel request with the same id won the race.
    const raced = data.id ? await transactionRepository.getOwned(db, userId, data.id) : null;
    if (raced !== null && sameAsRequest(raced, fields)) return [await out(db, userId, raced), false];
    throw new IdConflict();
  }
  return [await out(db, userId, row), true];
}

export async function getTransfer(userId: string, transferId: string): Promise<TransactionOut> {
  const db = getDb();
  const row = requireTransfer(await transactionRepository.getOwned(db, userId, transferId));
  return out(db, userId, row);
}

/** Apply a transfer edit inside the caller's transaction; returns the saved row. */
export async function updateTransferInTx(
  tx: Tx,
  userId: string,
  transferId: string,
  data: TransferUpdate,
): Promise<Transaction> {
  const row = requireTransfer(await transactionRepository.getOwned(tx, userId, transferId, true));
  checkVersion(row, data.version);
  const changes: TransferChanges = data.changes;

  const source = changes.sourceAccountId ?? row.accountId;
  const destination = changes.destinationAccountId ?? row.destinationAccountId!;
  const onDate = changes.transactionDate ?? row.transactionDate;
  checkDistinct(source, destination);

  const current = new Set([row.accountId, row.destinationAccountId]);
  const changed = new Set([source, destination].filter((a) => !current.has(a)));
  await validateAccounts(tx, userId, new Set([source, destination]), onDate, changed);

  const existingFee = (await transactionRepository.feesForParents(tx, [row.id])).get(row.id);
  const feeAmount = changes.feeAmount ?? dec(row.feeAmount);
  const feeAccount = changes.feeAccountId ?? existingFee?.accountId ?? source;
  if (feeAmount.greaterThan(0)) checkTransferFeeAccount(source, destination, feeAccount);

  if (changes.name !== undefined) row.name = changes.name;
  if ('description' in changes) row.description = changes.description ?? null;
  if (changes.amount !== undefined) row.amount = changes.amount.toFixed(2);
  if (changes.transactionDate !== undefined) row.transactionDate = changes.transactionDate;
  row.accountId = source;
  row.destinationAccountId = destination;
  await syncFee(tx, userId, row, { feeAmount, feeAccountId: feeAccount });
  row.version += 1;
  row.updatedAt = getClock().now();
  await transactionRepository.save(tx, row);
  return row;
}

export async function updateTransfer(userId: string, transferId: string, data: TransferUpdate): Promise<TransactionOut> {
  const row = await getDb().transaction((tx) => updateTransferInTx(tx, userId, transferId, data));
  console.info(`transfer_updated id=${row.id}`);
  return out(getDb(), userId, row);
}

export async function deleteTransfer(userId: string, transferId: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    const row = requireTransfer(await transactionRepository.getOwned(tx, userId, transferId, true));
    await transactionRepository.remove(tx, row); // its fee goes with it (ON DELETE CASCADE)
  });
  console.info(`transfer_deleted id=${transferId}`);
}
