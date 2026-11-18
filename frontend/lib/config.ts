/** Settings from the environment, mirroring backend/app/core/config.py. Validated on first use. */

export type AppEnv = 'development' | 'test' | 'production';
export type EmailProvider = 'disabled' | 'smtp' | 'brevo';

export interface Settings {
  ownerEmail: string;
  databaseUrl: string;
  secretKey: string;
  sessionCookieName: string;
  appEnv: AppEnv;
  frontendOrigin: string;

  sessionAbsoluteDays: number;
  sessionIdleHours: number;
  loginMaxFailuresPerIp: number;
  loginMaxFailuresPerAccount: number;
  loginWindowMinutes: number;
  passwordResetEnabled: boolean;
  passwordResetExpiryMinutes: number;
  passwordResetMaxRequests: number;
  passwordResetWindowMinutes: number;
  dataWipeExpiryMinutes: number;
  dataWipeMaxRequests: number;
  dataWipeWindowMinutes: number;
  dataWipeMaxAttempts: number;
  reportMaxRequests: number;
  reportWindowMinutes: number;
  emailProvider: EmailProvider;
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string | null;
  smtpPassword: string | null;
  smtpFromEmail: string;
  smtpStarttls: boolean;
  smtpTimeoutSeconds: number;
  trustedProxy: boolean;

  /** Secure cookies only in production. */
  cookieSecure: boolean;
}

/** Single email normalization used by config, login and provisioning. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TRUE_VALUES = new Set(['1', 'on', 't', 'true', 'y', 'yes']);
const FALSE_VALUES = new Set(['0', 'off', 'f', 'false', 'n', 'no']);

class SettingsError extends Error {}

function raw(name: string): string | undefined {
  return process.env[name];
}

function required(name: string): string {
  const value = raw(name);
  if (value === undefined) throw new SettingsError(`${name} is required`);
  return value;
}

function str(name: string, fallback: string): string {
  return raw(name) ?? fallback;
}

function optionalStr(name: string): string | null {
  return raw(name) ?? null;
}

function int(name: string, fallback: number, { gt, ge, le }: { gt?: number; ge?: number; le?: number } = {}): number {
  const value = raw(name);
  if (value === undefined) return fallback;
  const trimmed = value.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) throw new SettingsError(`${name} must be an integer`);
  const parsed = Number.parseInt(trimmed, 10);
  if (gt !== undefined && !(parsed > gt)) throw new SettingsError(`${name} must be greater than ${gt}`);
  if (ge !== undefined && parsed < ge) throw new SettingsError(`${name} must be at least ${ge}`);
  if (le !== undefined && parsed > le) throw new SettingsError(`${name} must be at most ${le}`);
  return parsed;
}

function float(name: string, fallback: number, { gt }: { gt?: number } = {}): number {
  const value = raw(name);
  if (value === undefined) return fallback;
  const parsed = Number(value.trim());
  if (value.trim() === '' || !Number.isFinite(parsed)) throw new SettingsError(`${name} must be a number`);
  if (gt !== undefined && !(parsed > gt)) throw new SettingsError(`${name} must be greater than ${gt}`);
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const value = raw(name);
  if (value === undefined) return fallback;
  const lowered = value.trim().toLowerCase();
  if (TRUE_VALUES.has(lowered)) return true;
  if (FALSE_VALUES.has(lowered)) return false;
  throw new SettingsError(`${name} must be a boolean`);
}

function literal<T extends string>(name: string, fallback: T, allowed: readonly T[]): T {
  const value = raw(name);
  if (value === undefined) return fallback;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new SettingsError(`${name} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

function loadSettings(): Settings {
  const ownerEmail = normalizeEmail(required('OWNER_EMAIL'));
  if (!EMAIL_PATTERN.test(ownerEmail)) {
    throw new SettingsError('OWNER_EMAIL is not a valid email address');
  }

  const secretKey = required('SECRET_KEY');
  if (Buffer.byteLength(secretKey, 'utf8') < 32) {
    throw new SettingsError('SECRET_KEY must be at least 32 bytes long');
  }

  const appEnv = literal<AppEnv>('APP_ENV', 'development', ['development', 'test', 'production']);
  const frontendOrigin = str('FRONTEND_ORIGIN', 'http://localhost:5173').trim().replace(/\/+$/, '');

  const settings: Settings = {
    ownerEmail,
    databaseUrl: required('DATABASE_URL'),
    secretKey,
    sessionCookieName: str('SESSION_COOKIE_NAME', 'finance_session'),
    appEnv,
    frontendOrigin,

    sessionAbsoluteDays: int('SESSION_ABSOLUTE_DAYS', 7, { gt: 0 }),
    sessionIdleHours: int('SESSION_IDLE_HOURS', 24, { gt: 0 }),
    loginMaxFailuresPerIp: int('LOGIN_MAX_FAILURES_PER_IP', 5, { gt: 0 }),
    loginMaxFailuresPerAccount: int('LOGIN_MAX_FAILURES_PER_ACCOUNT', 20, { gt: 0 }),
    loginWindowMinutes: int('LOGIN_WINDOW_MINUTES', 15, { gt: 0 }),
    passwordResetEnabled: bool('PASSWORD_RESET_ENABLED', false),
    passwordResetExpiryMinutes: int('PASSWORD_RESET_EXPIRY_MINUTES', 30, { gt: 0 }),
    passwordResetMaxRequests: int('PASSWORD_RESET_MAX_REQUESTS', 3, { gt: 0 }),
    passwordResetWindowMinutes: int('PASSWORD_RESET_WINDOW_MINUTES', 15, { gt: 0 }),
    dataWipeExpiryMinutes: int('DATA_WIPE_EXPIRY_MINUTES', 10, { gt: 0 }),
    dataWipeMaxRequests: int('DATA_WIPE_MAX_REQUESTS', 3, { gt: 0 }),
    dataWipeWindowMinutes: int('DATA_WIPE_WINDOW_MINUTES', 15, { gt: 0 }),
    dataWipeMaxAttempts: int('DATA_WIPE_MAX_ATTEMPTS', 5, { gt: 0 }),
    reportMaxRequests: int('REPORT_MAX_REQUESTS', 5, { gt: 0 }),
    reportWindowMinutes: int('REPORT_WINDOW_MINUTES', 15, { gt: 0 }),
    emailProvider: literal<EmailProvider>('EMAIL_PROVIDER', 'disabled', ['disabled', 'smtp', 'brevo']),
    smtpHost: str('SMTP_HOST', 'localhost'),
    smtpPort: int('SMTP_PORT', 25, { ge: 1, le: 65535 }),
    smtpUsername: optionalStr('SMTP_USERNAME'),
    smtpPassword: optionalStr('SMTP_PASSWORD'),
    smtpFromEmail: str('SMTP_FROM_EMAIL', 'no-reply@localhost'),
    smtpStarttls: bool('SMTP_STARTTLS', false),
    smtpTimeoutSeconds: float('SMTP_TIMEOUT_SECONDS', 10.0, { gt: 0 }),
    trustedProxy: bool('TRUSTED_PROXY', false),

    cookieSecure: appEnv === 'production',
  };

  if (settings.appEnv === 'production' && !settings.frontendOrigin.startsWith('https://')) {
    throw new SettingsError('FRONTEND_ORIGIN must use https:// when APP_ENV=production');
  }
  if (settings.passwordResetEnabled && settings.emailProvider === 'disabled') {
    throw new SettingsError('EMAIL_PROVIDER must be smtp or brevo when password reset is enabled');
  }
  if (
    settings.appEnv === 'production' &&
    settings.passwordResetEnabled &&
    settings.emailProvider === 'smtp' &&
    !settings.smtpStarttls
  ) {
    throw new SettingsError('SMTP_STARTTLS must be true when password reset is enabled in production');
  }
  if (settings.passwordResetEnabled && settings.emailProvider === 'brevo') {
    if (!settings.smtpUsername || !settings.smtpPassword) {
      throw new SettingsError('SMTP_USERNAME and SMTP_PASSWORD are required for the Brevo provider');
    }
    if (!settings.smtpFromEmail.trim()) {
      throw new SettingsError('SMTP_FROM_EMAIL is required for the Brevo provider');
    }
  }
  return settings;
}

let cached: Settings | undefined;

export function getSettings(): Settings {
  cached ??= loadSettings();
  return cached;
}
