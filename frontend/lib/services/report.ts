/** Owner reports: email a CSV of transactions for a date range. */
import { getClock } from '../clock';
import type { Settings } from '../config';
import { addMinutes, daysBetween } from '../dates';
import { getDb } from '../db/client';
import type { EmailSender } from '../email';
import { BusinessRuleError, ServiceUnavailable, TooManyAttempts } from '../errors';
import * as reportRequestRepository from '../repositories/reportRequests';
import * as transactionRepository from '../repositories/transactions';
import type { AuthContext } from './auth';
import { buildOuts, type TransactionOut } from './transactionSupport';

const MAX_RANGE_DAYS = 366;
const CSV_COLUMNS = [
  'date',
  'type',
  'name',
  'amount',
  'account',
  'destination_account',
  'category',
  'description',
  'is_fee',
  'related_transaction_id',
] as const;
export const ACCEPTED_MESSAGE = 'Your transaction CSV report was sent to your email.';

/** Python csv QUOTE_MINIMAL with lineterminator "\n". */
function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildTransactionsCsv(outs: TransactionOut[]): Buffer {
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of outs) {
    const record: Record<(typeof CSV_COLUMNS)[number], string> = {
      date: row.transaction_date,
      type: row.type,
      name: row.name,
      amount: row.amount,
      account: row.account.name,
      destination_account: row.destination_account ? row.destination_account.name : '',
      category: row.category ? row.category.name : '',
      description: row.description ?? '',
      is_fee: row.is_fee ? 'true' : 'false',
      related_transaction_id: row.related_transaction_id ?? '',
    };
    lines.push(CSV_COLUMNS.map((column) => csvField(record[column])).join(','));
  }
  // UTF-8 BOM helps Excel open the file correctly.
  return Buffer.from(`\ufeff${lines.join('\n')}\n`, 'utf8');
}

export async function emailTransactionsCsv(
  settings: Settings,
  sender: EmailSender,
  context: AuthContext,
  { startDate, endDate, sourceIp }: { startDate: string; endDate: string; sourceIp: string },
): Promise<{ message: string }> {
  if (settings.emailProvider === 'disabled') {
    throw new ServiceUnavailable('Email delivery is required to send a report.');
  }
  if (startDate > endDate) throw new BusinessRuleError('validation_error', 'The start date is after the end date.');
  if (daysBetween(startDate, endDate) + 1 > MAX_RANGE_DAYS) {
    throw new BusinessRuleError('range_too_long', `Choose a range of at most ${MAX_RANGE_DAYS} days.`);
  }

  const db = getDb();
  const now = getClock().now();
  const windowStart = addMinutes(now, -settings.reportWindowMinutes);
  if (
    (await reportRequestRepository.countForUserSince(db, context.userId, windowStart)) >= settings.reportMaxRequests ||
    (await reportRequestRepository.countForSourceSince(db, sourceIp, windowStart)) >= settings.reportMaxRequests
  ) {
    throw new TooManyAttempts(settings.reportWindowMinutes * 60);
  }

  const rows = await transactionRepository.listAll(db, context.userId, { startDate, endDate });
  if (rows.length === 0) {
    throw new BusinessRuleError('no_transactions', 'No transactions in that date range. Choose different dates.');
  }
  const outs = await buildOuts(db, context.userId, rows);
  const csvBytes = buildTransactionsCsv(outs);
  const filename = `transactions_${startDate}_to_${endDate}.csv`;

  try {
    await sender.sendTransactionCsvReport(context.user.email, { startDate, endDate, csvBytes, filename });
  } catch (error) {
    console.error(`transaction_csv_email_failed user_id=${context.userId} source_ip=${sourceIp}`, error);
    throw new ServiceUnavailable('Could not send the report email. Try again later.');
  }

  await reportRequestRepository.create(db, { userId: context.userId, sourceIp, now });
  console.info(`transaction_csv_sent user_id=${context.userId} rows=${outs.length} source_ip=${sourceIp}`);
  return { message: ACCEPTED_MESSAGE };
}
