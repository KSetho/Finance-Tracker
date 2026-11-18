/** Owner-only finance data wipe, gated by a short-lived emailed verification code. */
import { randomInt } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { hashToken, safeEqual } from '../auth/crypto';
import { getClock } from '../clock';
import type { Settings } from '../config';
import { addMinutes } from '../dates';
import { getDb, type Tx } from '../db/client';
import {
  accounts,
  categories,
  dataWipeTokens,
  loginAttempts,
  monthlyBudgets,
  passwordResetTokens,
  transactions,
} from '../db/schema';
import type { EmailSender } from '../email';
import { InvalidWipeCode, ServiceUnavailable, TooManyAttempts } from '../errors';
import * as dataWipeRepository from '../repositories/dataWipe';
import * as sessionRepository from '../repositories/sessions';
import type { AuthContext } from './auth';
import { seedDefaults } from './category';

export const REQUEST_ACCEPTED_MESSAGE = 'A verification code was sent to your email.';
const MAX_CODE = 1_000_000;

function newCode(): string {
  return String(randomInt(MAX_CODE)).padStart(6, '0');
}

class EmailDeliveryFailed extends Error {}

export async function requestWipe(
  settings: Settings,
  sender: EmailSender,
  context: AuthContext,
  { sourceIp }: { sourceIp: string },
): Promise<{ message: string }> {
  if (settings.emailProvider === 'disabled') {
    throw new ServiceUnavailable('Email delivery is required to wipe data.');
  }

  const now = getClock().now();
  const windowStart = addMinutes(now, -settings.dataWipeWindowMinutes);
  try {
    // The token is only committed once the email has gone out; a send failure rolls it back.
    await getDb().transaction(async (tx) => {
      if (
        (await dataWipeRepository.countForSourceSince(tx, sourceIp, windowStart)) >= settings.dataWipeMaxRequests ||
        (await dataWipeRepository.countForUserSince(tx, context.userId, windowStart)) >= settings.dataWipeMaxRequests
      ) {
        throw new TooManyAttempts(settings.dataWipeWindowMinutes * 60);
      }

      const code = newCode();
      await dataWipeRepository.invalidateActiveForUser(tx, context.userId, now);
      await dataWipeRepository.create(tx, {
        userId: context.userId,
        tokenHash: hashToken(code),
        sourceIp,
        now,
        expiresAt: addMinutes(now, settings.dataWipeExpiryMinutes),
      });

      try {
        await sender.sendDataWipeCode(context.user.email, code, settings.dataWipeExpiryMinutes);
      } catch (error) {
        console.error(`data_wipe_email_failed user_id=${context.userId} source_ip=${sourceIp}`, error);
        throw new EmailDeliveryFailed();
      }
    });
  } catch (error) {
    if (error instanceof EmailDeliveryFailed) {
      throw new ServiceUnavailable('Could not send the verification email. Try again later.');
    }
    throw error;
  }

  console.info(`data_wipe_code_sent user_id=${context.userId} source_ip=${sourceIp}`);
  return { message: REQUEST_ACCEPTED_MESSAGE };
}

export async function confirmWipe(settings: Settings, context: AuthContext, { code }: { code: string }): Promise<void> {
  const now = getClock().now();
  const wiped = await getDb().transaction(async (tx) => {
    const row = await dataWipeRepository.getActiveForUserForUpdate(tx, context.userId, now);
    if (row === null) throw new InvalidWipeCode();

    if (!safeEqual(row.tokenHash, hashToken(code.trim()))) {
      // Committed: the failed attempt counts even though the request ends in an error.
      const attempts = await dataWipeRepository.recordFailedAttempt(tx, row);
      if (attempts >= settings.dataWipeMaxAttempts) await dataWipeRepository.consume(tx, row, now);
      return false;
    }

    await dataWipeRepository.consume(tx, row, now);
    await wipeFinanceData(tx, context, now);
    return true;
  });
  if (!wiped) throw new InvalidWipeCode();
  console.info(`data_wipe_completed user_id=${context.userId}`);
}

async function wipeFinanceData(tx: Tx, context: AuthContext, now: Date): Promise<void> {
  const userId = context.userId;
  await tx.delete(transactions).where(eq(transactions.userId, userId));
  await tx.delete(accounts).where(eq(accounts.userId, userId));
  await tx.delete(monthlyBudgets).where(eq(monthlyBudgets.userId, userId));
  await tx.delete(categories).where(eq(categories.userId, userId));
  await tx.delete(loginAttempts).where(eq(loginAttempts.email, context.user.email));
  await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
  await tx.delete(dataWipeTokens).where(eq(dataWipeTokens.userId, userId));
  await seedDefaults(tx, userId);
  await sessionRepository.revokeOthersForUser(tx, userId, { keepSessionId: context.session.id, now });
}
