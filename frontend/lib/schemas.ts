/** Request body parsers (mirror backend/app/schemas/*). Unknown fields are ignored, like Pydantic. */
import { accountTypeEnum, type AccountType, transactionTypeEnum, type TransactionType } from './db/schema';
import { ZERO, type Decimal } from './money';
import {
  dateValue,
  enumValue,
  has,
  intValue,
  invalid,
  nonNegativeMoney,
  nullable,
  positiveMoney,
  type Raw,
  required,
  str,
  uuidValue,
  withDefault,
} from './validation';

const accountName = str({ strip: true, min: 1, max: 80 });
const txName = str({ strip: true, min: 1, max: 120 });
const txDescription = str({ strip: true, max: 500 });
const accountType = enumValue<AccountType>(accountTypeEnum.enumValues);
const transactionType = enumValue<TransactionType>(transactionTypeEnum.enumValues);

/** Description: stripped, blank -> null. */
function description(raw: Raw): string | null {
  return nullable(raw, 'description', txDescription) || null;
}

/** For partial updates: only keys that were sent; null rejected unless the key is in `nullableKeys`. */
function partial<T extends object>(
  raw: Raw,
  parsers: { [K in keyof T]: (value: unknown) => T[K] },
  nullableKeys: ReadonlyArray<keyof T> = [],
): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(parsers) as (keyof T)[]) {
    const name = key as string;
    if (!has(raw, name)) continue;
    const value = raw[name];
    if (value === null) {
      if (!nullableKeys.includes(key)) invalid();
      out[key] = null as T[keyof T];
    } else {
      out[key] = parsers[key](value);
    }
  }
  return out;
}

// ---- auth -------------------------------------------------------------------------------------

function nonBlankEmail(value: unknown): string {
  const email = str({ max: 320 })(value);
  if (!email.trim()) invalid();
  return email;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export function parseLogin(raw: Raw): LoginRequest {
  return {
    email: required(raw, 'email', nonBlankEmail),
    password: required(raw, 'password', str({ min: 1, max: 1024 })),
  };
}

export function parseForgotPassword(raw: Raw): { email: string } {
  return { email: required(raw, 'email', nonBlankEmail) };
}

export function parseResetPassword(raw: Raw): { token: string; password: string } {
  return {
    token: required(raw, 'token', str({ min: 1, max: 512 })),
    password: required(raw, 'password', str({ min: 10, max: 1024 })),
  };
}

// ---- accounts ---------------------------------------------------------------------------------

export interface AccountCreate {
  id: string | null;
  name: string;
  accountType: AccountType;
  openingBalance: Decimal;
  openingDate: string;
}

export function parseAccountCreate(raw: Raw): AccountCreate {
  return {
    id: nullable(raw, 'id', uuidValue),
    name: required(raw, 'name', accountName),
    accountType: required(raw, 'account_type', accountType),
    openingBalance: withDefault(raw, 'opening_balance', nonNegativeMoney, ZERO),
    openingDate: required(raw, 'opening_date', dateValue),
  };
}

export interface AccountUpdate {
  name: string;
  openingBalance: Decimal;
  openingDate: string;
}

export function parseAccountUpdate(raw: Raw): Partial<AccountUpdate> {
  const parsed = partial<{ name: string; opening_balance: Decimal; opening_date: string }>(raw, {
    name: accountName,
    opening_balance: nonNegativeMoney,
    opening_date: dateValue,
  });
  const out: Partial<AccountUpdate> = {};
  if (parsed.name !== undefined) out.name = parsed.name;
  if (parsed.opening_balance !== undefined) out.openingBalance = parsed.opening_balance;
  if (parsed.opening_date !== undefined) out.openingDate = parsed.opening_date;
  return out;
}

// ---- transactions -----------------------------------------------------------------------------

export interface IncomeCreate {
  kind: 'income';
  id: string | null;
  name: string;
  description: string | null;
  amount: Decimal;
  transactionDate: string;
  accountId: string;
  categoryId: string | null;
}

export interface ExpenseCreate {
  kind: 'expense';
  id: string | null;
  name: string;
  description: string | null;
  amount: Decimal;
  transactionDate: string;
  accountId: string;
  categoryId: string;
  feeAmount: Decimal;
  feeAccountId: string | null;
}

export function parseIncomeCreate(raw: Raw): IncomeCreate {
  return {
    kind: 'income',
    id: nullable(raw, 'id', uuidValue),
    name: required(raw, 'name', txName),
    description: description(raw),
    amount: required(raw, 'amount', positiveMoney),
    transactionDate: required(raw, 'transaction_date', dateValue),
    accountId: required(raw, 'account_id', uuidValue),
    categoryId: nullable(raw, 'category_id', uuidValue),
  };
}

export function parseExpenseCreate(raw: Raw): ExpenseCreate {
  return {
    kind: 'expense',
    id: nullable(raw, 'id', uuidValue),
    name: required(raw, 'name', txName),
    description: description(raw),
    amount: required(raw, 'amount', positiveMoney),
    transactionDate: required(raw, 'transaction_date', dateValue),
    accountId: required(raw, 'account_id', uuidValue),
    categoryId: required(raw, 'category_id', uuidValue),
    feeAmount: withDefault(raw, 'fee_amount', nonNegativeMoney, ZERO),
    feeAccountId: nullable(raw, 'fee_account_id', uuidValue),
  };
}

/** Fields of a partial transaction edit; a key is present only when it was sent. */
export interface TransactionChanges {
  name?: string;
  description?: string | null;
  amount?: Decimal;
  transactionDate?: string;
  accountId?: string;
  categoryId?: string | null;
  feeAmount?: Decimal;
  feeAccountId?: string;
}

export interface TransactionUpdate {
  version: number;
  type: TransactionType | null;
  changes: TransactionChanges;
}

export function parseTransactionUpdate(raw: Raw): TransactionUpdate {
  const version = required(raw, 'version', intValue);
  const type = nullable(raw, 'type', transactionType);
  const parsed = partial<{
    name: string;
    description: string | null;
    amount: Decimal;
    transaction_date: string;
    account_id: string;
    category_id: string | null;
    fee_amount: Decimal;
    fee_account_id: string;
  }>(
    raw,
    {
      name: txName,
      description: (value) => txDescription(value) || null,
      amount: positiveMoney,
      transaction_date: dateValue,
      account_id: uuidValue,
      category_id: uuidValue,
      fee_amount: nonNegativeMoney,
      fee_account_id: uuidValue,
    },
    ['description', 'category_id'],
  );
  const changes: TransactionChanges = {};
  if ('name' in parsed) changes.name = parsed.name;
  if ('description' in parsed) changes.description = parsed.description ?? null;
  if ('amount' in parsed) changes.amount = parsed.amount;
  if ('transaction_date' in parsed) changes.transactionDate = parsed.transaction_date;
  if ('account_id' in parsed) changes.accountId = parsed.account_id;
  if ('category_id' in parsed) changes.categoryId = parsed.category_id ?? null;
  if ('fee_amount' in parsed) changes.feeAmount = parsed.fee_amount;
  if ('fee_account_id' in parsed) changes.feeAccountId = parsed.fee_account_id;
  return { version, type, changes };
}

// ---- transfers --------------------------------------------------------------------------------

export interface TransferCreate {
  id: string | null;
  name: string;
  description: string | null;
  amount: Decimal;
  transactionDate: string;
  sourceAccountId: string;
  destinationAccountId: string;
  feeAmount: Decimal;
  feeAccountId: string | null;
}

export function parseTransferCreate(raw: Raw): TransferCreate {
  return {
    id: nullable(raw, 'id', uuidValue),
    name: required(raw, 'name', txName),
    description: description(raw),
    amount: required(raw, 'amount', positiveMoney),
    transactionDate: required(raw, 'transaction_date', dateValue),
    sourceAccountId: required(raw, 'source_account_id', uuidValue),
    destinationAccountId: required(raw, 'destination_account_id', uuidValue),
    feeAmount: withDefault(raw, 'fee_amount', nonNegativeMoney, ZERO),
    feeAccountId: nullable(raw, 'fee_account_id', uuidValue),
  };
}

export interface TransferChanges {
  name?: string;
  description?: string | null;
  amount?: Decimal;
  transactionDate?: string;
  sourceAccountId?: string;
  destinationAccountId?: string;
  feeAmount?: Decimal;
  feeAccountId?: string;
}

export interface TransferUpdate {
  version: number;
  changes: TransferChanges;
}

export function parseTransferUpdate(raw: Raw): TransferUpdate {
  const version = required(raw, 'version', intValue);
  const parsed = partial<{
    name: string;
    description: string | null;
    amount: Decimal;
    transaction_date: string;
    source_account_id: string;
    destination_account_id: string;
    fee_amount: Decimal;
    fee_account_id: string;
  }>(
    raw,
    {
      name: txName,
      description: (value) => txDescription(value) || null,
      amount: positiveMoney,
      transaction_date: dateValue,
      source_account_id: uuidValue,
      destination_account_id: uuidValue,
      fee_amount: nonNegativeMoney,
      fee_account_id: uuidValue,
    },
    ['description'],
  );
  const changes: TransferChanges = {};
  if ('name' in parsed) changes.name = parsed.name;
  if ('description' in parsed) changes.description = parsed.description ?? null;
  if ('amount' in parsed) changes.amount = parsed.amount;
  if ('transaction_date' in parsed) changes.transactionDate = parsed.transaction_date;
  if ('source_account_id' in parsed) changes.sourceAccountId = parsed.source_account_id;
  if ('destination_account_id' in parsed) changes.destinationAccountId = parsed.destination_account_id;
  if ('fee_amount' in parsed) changes.feeAmount = parsed.fee_amount;
  if ('fee_account_id' in parsed) changes.feeAccountId = parsed.fee_account_id;
  return { version, changes };
}

// ---- budgets, data wipe, reports --------------------------------------------------------------

export function parseBudgetUpdate(raw: Raw): { allowance: Decimal } {
  return { allowance: required(raw, 'allowance', nonNegativeMoney) };
}

export function parseDataWipeConfirm(raw: Raw): { code: string } {
  const code = required(raw, 'code', str({ min: 6, max: 6 }));
  if (!/^\d{6}$/.test(code)) invalid();
  return { code };
}

export function parseTransactionCsvReport(raw: Raw): { startDate: string; endDate: string } {
  const startDate = required(raw, 'start_date', dateValue);
  const endDate = required(raw, 'end_date', dateValue);
  if (startDate > endDate) invalid();
  return { startDate, endDate };
}
