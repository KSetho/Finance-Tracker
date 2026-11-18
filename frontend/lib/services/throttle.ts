import type { Settings } from '../config';
import { addMinutes } from '../dates';
import type { Executor } from '../db/client';
import { TooManyAttempts } from '../errors';
import * as attempts from '../repositories/loginAttempts';

function windowMinutes(settings: Settings): number {
  return settings.loginWindowMinutes;
}

/** Throw TooManyAttempts when the source IP or the owner account is over its failure limit. */
export async function check(
  db: Executor,
  settings: Settings,
  now: Date,
  sourceIp: string,
  email: string,
): Promise<void> {
  const window = windowMinutes(settings);
  const since = addMinutes(now, -window);
  const retryAfter: number[] = [];

  if ((await attempts.countForIpSince(db, sourceIp, since)) >= settings.loginMaxFailuresPerIp) {
    const oldest = await attempts.oldestForIpSince(db, sourceIp, since);
    if (oldest !== null) retryAfter.push((addMinutes(oldest, window).getTime() - now.getTime()) / 1000);
  }

  if (
    email === settings.ownerEmail &&
    (await attempts.countForEmailSince(db, email, since)) >= settings.loginMaxFailuresPerAccount
  ) {
    const oldest = await attempts.oldestForEmailSince(db, email, since);
    if (oldest !== null) retryAfter.push((addMinutes(oldest, window).getTime() - now.getTime()) / 1000);
  }

  if (retryAfter.length > 0) {
    console.warn(`login_throttled source_ip=${sourceIp}`);
    throw new TooManyAttempts(Math.ceil(Math.max(...retryAfter)));
  }
}

export async function recordFailure(db: Executor, now: Date, sourceIp: string, email: string): Promise<void> {
  await attempts.add(db, { sourceIp, email, now });
}

export async function clear(db: Executor, sourceIp: string): Promise<void> {
  await attempts.deleteForIp(db, sourceIp);
}

export async function purge(db: Executor, settings: Settings, now: Date): Promise<void> {
  await attempts.purgeBefore(db, addMinutes(now, -windowMinutes(settings)));
}
