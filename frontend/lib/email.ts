/** Outbound email (port of backend/app/core/email.py) over SMTP via nodemailer. */
import nodemailer, { type SendMailOptions } from 'nodemailer';

import type { Settings } from './config';

export interface EmailSender {
  sendPasswordReset(recipient: string, resetUrl: string, expiryMinutes: number): Promise<void>;
  sendDataWipeCode(recipient: string, code: string, expiryMinutes: number): Promise<void>;
  sendTransactionCsvReport(
    recipient: string,
    options: { startDate: string; endDate: string; csvBytes: Buffer; filename: string },
  ): Promise<void>;
}

class DisabledEmailSender implements EmailSender {
  async sendPasswordReset(): Promise<void> {
    throw new Error('Email delivery is disabled');
  }

  async sendDataWipeCode(): Promise<void> {
    throw new Error('Email delivery is disabled');
  }

  async sendTransactionCsvReport(): Promise<void> {
    throw new Error('Email delivery is disabled');
  }
}

class SmtpEmailSender implements EmailSender {
  private readonly host: string;
  private readonly port: number;
  private readonly starttls: boolean;

  constructor(private readonly settings: Settings) {
    const brevo = settings.emailProvider === 'brevo';
    this.host = brevo ? 'smtp-relay.brevo.com' : settings.smtpHost;
    this.port = brevo ? 587 : settings.smtpPort;
    this.starttls = brevo || settings.smtpStarttls;
  }

  private async deliver(message: SendMailOptions): Promise<void> {
    const timeout = Math.round(this.settings.smtpTimeoutSeconds * 1000);
    const transport = nodemailer.createTransport({
      host: this.host,
      port: this.port,
      secure: false,
      requireTLS: this.starttls,
      ignoreTLS: !this.starttls,
      auth: this.settings.smtpUsername
        ? { user: this.settings.smtpUsername, pass: this.settings.smtpPassword ?? '' }
        : undefined,
      connectionTimeout: timeout,
      greetingTimeout: timeout,
      socketTimeout: timeout,
    });
    try {
      await transport.sendMail({ from: this.settings.smtpFromEmail, ...message });
    } finally {
      transport.close();
    }
  }

  private send(recipient: string, subject: string, text: string): Promise<void> {
    return this.deliver({ to: recipient, subject, text });
  }

  sendPasswordReset(recipient: string, resetUrl: string, expiryMinutes: number): Promise<void> {
    return this.send(
      recipient,
      'Reset your Finance Tracker password',
      'Use this link to reset your Finance Tracker password:\n\n' +
        `${resetUrl}\n\n` +
        `This link expires in ${expiryMinutes} minutes. If you did not request it, ignore ` +
        'this email.',
    );
  }

  sendDataWipeCode(recipient: string, code: string, expiryMinutes: number): Promise<void> {
    return this.send(
      recipient,
      'Confirm Finance Tracker data wipe',
      'Use this verification code to wipe finance data in Finance Tracker:\n\n' +
        `${code}\n\n` +
        `This code expires in ${expiryMinutes} minutes. If you did not request a data ` +
        'wipe, ignore this email — your data will not be changed.',
    );
  }

  sendTransactionCsvReport(
    recipient: string,
    { startDate, endDate, csvBytes, filename }: { startDate: string; endDate: string; csvBytes: Buffer; filename: string },
  ): Promise<void> {
    return this.deliver({
      to: recipient,
      subject: `Finance Tracker transactions ${startDate} to ${endDate}`,
      text:
        'Your Finance Tracker transaction report is attached.\n\n' +
        `Date range: ${startDate} to ${endDate} (inclusive).\n\n` +
        'If you did not request this report, you can ignore this email.',
      attachments: [{ filename, content: csvBytes, contentType: 'text/csv' }],
    });
  }
}

let override: EmailSender | undefined;

/** Swap the sender (tests). */
export function setEmailSender(sender: EmailSender | undefined): void {
  override = sender;
}

export function makeEmailSender(settings: Settings): EmailSender {
  if (override) return override;
  if (settings.emailProvider === 'disabled') return new DisabledEmailSender();
  return new SmtpEmailSender(settings);
}
