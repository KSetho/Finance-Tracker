/**
 * Drizzle mirror of the existing Neon schema (backend/app/models + backend/migrations).
 * Alembic owns migrations; constraint and index names match it so introspection diffs stay clean.
 */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const accountTypeEnum = pgEnum('account_type', ['bank', 'mobile_money', 'cash']);
export const categoryTypeEnum = pgEnum('category_type', ['income', 'expense']);
export const transactionTypeEnum = pgEnum('transaction_type', ['income', 'expense', 'transfer']);

export type AccountType = (typeof accountTypeEnum.enumValues)[number];
export type CategoryType = (typeof categoryTypeEnum.enumValues)[number];
export type TransactionType = (typeof transactionTypeEnum.enumValues)[number];

const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const utc = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const day = (name: string) => date(name, { mode: 'string' });

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: utc('created_at').notNull().defaultNow(),
    updatedAt: utc('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('uq_users_email').on(t.email),
    check('ck_users_email_normalized', sql`email = lower(trim(email))`),
    uniqueIndex('users_single_owner').on(sql`(true)`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: utc('created_at').notNull().defaultNow(),
    lastSeenAt: utc('last_seen_at').notNull().defaultNow(),
    expiresAt: utc('expires_at').notNull(),
    revokedAt: utc('revoked_at'),
  },
  (t) => [unique('uq_sessions_token_hash').on(t.tokenHash), index('ix_sessions_user_id').on(t.userId)],
);

export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: id(),
    sourceIp: text('source_ip').notNull(),
    email: text('email').notNull(),
    attemptedAt: utc('attempted_at').notNull(),
  },
  (t) => [
    index('ix_login_attempts_ip_time').on(t.sourceIp, t.attemptedAt),
    index('ix_login_attempts_email_time').on(t.email, t.attemptedAt),
  ],
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    sourceIp: varchar('source_ip', { length: 64 }).notNull(),
    createdAt: utc('created_at').notNull().defaultNow(),
    expiresAt: utc('expires_at').notNull(),
    consumedAt: utc('consumed_at'),
  },
  (t) => [
    unique('uq_password_reset_tokens_token_hash').on(t.tokenHash),
    index('ix_password_reset_tokens_user_created').on(t.userId, t.createdAt),
    index('ix_password_reset_tokens_source_created').on(t.sourceIp, t.createdAt),
  ],
);

export const dataWipeTokens = pgTable(
  'data_wipe_tokens',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    sourceIp: varchar('source_ip', { length: 64 }).notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    createdAt: utc('created_at').notNull().defaultNow(),
    expiresAt: utc('expires_at').notNull(),
    consumedAt: utc('consumed_at'),
  },
  (t) => [
    unique('uq_data_wipe_tokens_token_hash').on(t.tokenHash),
    index('ix_data_wipe_tokens_user_created').on(t.userId, t.createdAt),
    index('ix_data_wipe_tokens_source_created').on(t.sourceIp, t.createdAt),
  ],
);

export const reportRequests = pgTable(
  'report_requests',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourceIp: varchar('source_ip', { length: 64 }).notNull(),
    createdAt: utc('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('ix_report_requests_user_created').on(t.userId, t.createdAt),
    index('ix_report_requests_source_created').on(t.sourceIp, t.createdAt),
  ],
);

export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    name: varchar('name', { length: 80 }).notNull(),
    accountType: accountTypeEnum('account_type').notNull(),
    openingBalance: money('opening_balance').notNull().default('0'),
    openingDate: day('opening_date').notNull(),
    isArchived: boolean('is_archived').notNull().default(false),
    createdAt: utc('created_at').notNull().defaultNow(),
    updatedAt: utc('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('ck_accounts_opening_balance_nonneg', sql`opening_balance >= 0`),
    uniqueIndex('uq_accounts_id_user').on(t.id, t.userId),
    uniqueIndex('uq_accounts_user_lower_name').on(t.userId, sql`lower(name)`),
  ],
);

export const categories = pgTable(
  'categories',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    name: varchar('name', { length: 60 }).notNull(),
    categoryType: categoryTypeEnum('category_type').notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: utc('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_categories_id_user').on(t.id, t.userId),
    uniqueIndex('uq_categories_user_type_name').on(t.userId, t.categoryType, t.name),
  ],
);

/** Income, expense or transfer. A fee is an expense row whose related_transaction_id is its
 * parent; the parent's fee_amount is the input value and is never summed. */
export const transactions = pgTable(
  'transactions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    type: transactionTypeEnum('type').notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    description: text('description'),
    amount: money('amount').notNull(),
    transactionDate: day('transaction_date').notNull(),
    accountId: uuid('account_id').notNull(),
    destinationAccountId: uuid('destination_account_id'),
    categoryId: uuid('category_id'),
    feeAmount: money('fee_amount').notNull().default('0'),
    relatedTransactionId: uuid('related_transaction_id').references((): AnyPgColumn => transactions.id, {
      onDelete: 'cascade',
    }),
    version: integer('version').notNull().default(1),
    createdAt: utc('created_at').notNull().defaultNow(),
    updatedAt: utc('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('ck_transactions_amount_positive', sql`amount > 0`),
    check('ck_transactions_fee_nonneg', sql`fee_amount >= 0`),
    check(
      'ck_transactions_shape',
      sql`(type IN ('income', 'expense') AND account_id IS NOT NULL AND destination_account_id IS NULL) OR (type = 'transfer' AND account_id IS NOT NULL AND destination_account_id IS NOT NULL AND account_id <> destination_account_id)`,
    ),
    check(
      'ck_transactions_fee_row',
      sql`related_transaction_id IS NULL OR (type = 'expense' AND fee_amount = 0)`,
    ),
    foreignKey({
      name: 'fk_tx_account_owner',
      columns: [t.accountId, t.userId],
      foreignColumns: [accounts.id, accounts.userId],
    }),
    foreignKey({
      name: 'fk_tx_destination_owner',
      columns: [t.destinationAccountId, t.userId],
      foreignColumns: [accounts.id, accounts.userId],
    }),
    foreignKey({
      name: 'fk_tx_category_owner',
      columns: [t.categoryId, t.userId],
      foreignColumns: [categories.id, categories.userId],
    }),
    uniqueIndex('uq_transactions_related')
      .on(t.relatedTransactionId)
      .where(sql`related_transaction_id IS NOT NULL`),
    index('ix_transactions_user_date').on(t.userId, t.transactionDate.desc(), t.createdAt.desc()),
    index('ix_transactions_user_type_date').on(t.userId, t.type, t.transactionDate),
    index('ix_transactions_account').on(t.accountId),
    index('ix_transactions_destination').on(t.destinationAccountId),
    index('ix_transactions_category').on(t.categoryId),
  ],
);

export const monthlyBudgets = pgTable(
  'monthly_budgets',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    monthStart: day('month_start').notNull(),
    allowance: money('allowance').notNull(),
    createdAt: utc('created_at').notNull().defaultNow(),
    updatedAt: utc('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('ck_budgets_allowance_nonneg', sql`allowance >= 0`),
    check('ck_budgets_month_start', sql`EXTRACT(day FROM month_start) = 1`),
    uniqueIndex('uq_budgets_user_month').on(t.userId, t.monthStart),
  ],
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type DataWipeToken = typeof dataWipeTokens.$inferSelect;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
