import * as accounting from '../accounting';
import { getClock } from '../clock';
import { isoDateTime } from '../dates';
import { type Executor, getDb, isIntegrityError } from '../db/client';
import type { Account, AccountType } from '../db/schema';
import { BusinessRuleError, IdConflict, NotFound } from '../errors';
import { type Decimal, dec, formatMoney } from '../money';
import * as accountRepository from '../repositories/accounts';
import type { AccountCreate, AccountUpdate } from '../schemas';

const DUPLICATE_NAME = 'An account with this name already exists.';

export interface AccountOut {
  id: string;
  name: string;
  account_type: AccountType;
  opening_balance: string;
  opening_date: string;
  is_archived: boolean;
  balance: string;
  created_at: string;
  updated_at: string;
}

export interface AccountList {
  items: AccountOut[];
  combined_balance: string;
}

function out(account: Account, balance: Decimal): AccountOut {
  return {
    id: account.id,
    name: account.name,
    account_type: account.accountType,
    opening_balance: formatMoney(account.openingBalance),
    opening_date: account.openingDate,
    is_archived: account.isArchived,
    balance: formatMoney(balance),
    created_at: isoDateTime(account.createdAt),
    updated_at: isoDateTime(account.updatedAt),
  };
}

async function view(db: Executor, userId: string, account: Account): Promise<AccountOut> {
  const balances = await accounting.accountBalances(db, userId, [account.id]);
  return out(account, balances.get(account.id)!);
}

function sameFields(account: Account, data: AccountCreate): boolean {
  return (
    account.name === data.name &&
    account.accountType === data.accountType &&
    dec(account.openingBalance).equals(data.openingBalance) &&
    account.openingDate === data.openingDate
  );
}

export async function listAccounts(userId: string, includeArchived: boolean): Promise<AccountList> {
  const db = getDb();
  const accounts = await accountRepository.listForUser(db, userId, includeArchived);
  const balances = await accounting.accountBalances(
    db,
    userId,
    accounts.map((a) => a.id),
  );
  return {
    items: accounts.map((a) => out(a, balances.get(a.id)!)),
    combined_balance: formatMoney(await accounting.combinedBalance(db, userId)),
  };
}

export async function getAccount(userId: string, accountId: string): Promise<AccountOut> {
  const db = getDb();
  const account = await accountRepository.getOwned(db, userId, accountId);
  if (account === null) throw new NotFound();
  return view(db, userId, account);
}

/** Returns [account, created]. A retry with the same id and fields returns the original. */
export async function createAccount(userId: string, data: AccountCreate): Promise<[AccountOut, boolean]> {
  const db = getDb();
  if (data.id !== null) {
    const existing = await accountRepository.getOwned(db, userId, data.id);
    if (existing !== null) {
      if (sameFields(existing, data)) return [await view(db, userId, existing), false];
      throw new IdConflict();
    }
  }
  if (await accountRepository.nameExists(db, userId, data.name)) {
    throw new BusinessRuleError('validation_error', DUPLICATE_NAME);
  }

  const now = getClock().now();
  let account: Account;
  try {
    account = await accountRepository.add(db, {
      id: data.id ?? crypto.randomUUID(),
      userId,
      name: data.name,
      accountType: data.accountType,
      openingBalance: data.openingBalance.toFixed(2),
      openingDate: data.openingDate,
      createdAt: now,
      updatedAt: now,
    });
    console.info(`account_created id=${account.id}`);
  } catch (error) {
    if (!isIntegrityError(error)) throw error;
    // A parallel request with the same id, or the same name, won the race.
    const raced = data.id ? await accountRepository.getOwned(db, userId, data.id) : null;
    if (raced !== null && sameFields(raced, data)) return [await view(db, userId, raced), false];
    if (raced !== null || (data.id !== null && !(await accountRepository.nameExists(db, userId, data.name)))) {
      throw new IdConflict();
    }
    throw new BusinessRuleError('validation_error', DUPLICATE_NAME);
  }
  return [await view(db, userId, account), true];
}

export async function updateAccount(
  userId: string,
  accountId: string,
  changes: Partial<AccountUpdate>,
): Promise<AccountOut> {
  const updated = await getDb().transaction(async (tx) => {
    const account = await accountRepository.getOwned(tx, userId, accountId, true);
    if (account === null) throw new NotFound();

    if (changes.name !== undefined && (await accountRepository.nameExists(tx, userId, changes.name, account.id))) {
      throw new BusinessRuleError('validation_error', DUPLICATE_NAME);
    }

    if (changes.openingDate !== undefined) {
      const earliest = await accountRepository.earliestActivityDate(tx, account.id);
      if (earliest !== null && changes.openingDate > earliest) {
        throw new BusinessRuleError(
          'activity_before_opening_date',
          'This account has activity before that date. Choose an earlier opening date.',
        );
      }
    }

    return accountRepository.update(tx, account.id, {
      ...(changes.name !== undefined && { name: changes.name }),
      ...(changes.openingBalance !== undefined && { openingBalance: changes.openingBalance.toFixed(2) }),
      ...(changes.openingDate !== undefined && { openingDate: changes.openingDate }),
      updatedAt: getClock().now(),
    });
  });
  return view(getDb(), userId, updated);
}

export async function archiveAccount(userId: string, accountId: string): Promise<AccountOut> {
  const account = await getDb().transaction(async (tx) => {
    const row = await accountRepository.getOwned(tx, userId, accountId, true);
    if (row === null) throw new NotFound();
    if (row.isArchived) return row;
    const archived = await accountRepository.update(tx, row.id, { isArchived: true, updatedAt: getClock().now() });
    console.info(`account_archived id=${row.id}`);
    return archived;
  });
  return view(getDb(), userId, account);
}
