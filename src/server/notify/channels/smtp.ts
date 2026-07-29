import nodemailer from 'nodemailer';
import { withRetry, DEFAULT_TIMEOUT_MS, type RetryOptions } from '../retry.js';
import type { Channel, ChannelMessage } from './types.js';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
  to: string;
}

export interface SmtpChannelOptions extends RetryOptions {
  timeoutMs?: number;
  /** Test-only: swaps nodemailer's real `createTransport` for a stub — kept as an escape
   * hatch mirroring every other test-injectable-constructor-knob in this codebase, even
   * though `tests/notify/channels/smtp.test.ts` prefers a real local `smtp-server`
   * instance instead of using this (see that file's header comment). */
  createTransport?: typeof nodemailer.createTransport;
}

/**
 * SMTP sender via `nodemailer` (added as a Task 2 dependency — this is the one channel
 * that isn't a bare `fetch` POST). `connectionTimeout`/`greetingTimeout`/`socketTimeout`
 * are all set to the same `timeoutMs` so a hung connection at any stage of the SMTP
 * handshake is bounded the same way every other channel's `AbortSignal.timeout` is. A
 * fresh transporter is created and closed per `send()` call (Task 2 spec has no
 * "keep a pooled SMTP connection alive" requirement — unlike `mqttSender.ts`, whose
 * "lazily shared client" is explicit spec text) so a config change between sends (e.g. a
 * settings PATCH between two send-test calls) can never use a stale connection.
 *
 * Never surfaces a raw nodemailer error (which could echo back server-provided text) —
 * normalizes to a fixed, humanized message so `password` (the one secret in this config;
 * see `db/settings.ts`'s `alertChannels.smtp.password` masking) can never leak through an
 * error, even though nodemailer itself doesn't normally embed it in errors either.
 */
export class SmtpChannel implements Channel {
  readonly name = 'smtp' as const;

  constructor(private readonly config: SmtpConfig, private readonly opts: SmtpChannelOptions = {}) {}

  async send(msg: ChannelMessage): Promise<void> {
    const timeoutMs = this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const createTransport = this.opts.createTransport ?? nodemailer.createTransport;

    await withRetry(async () => {
      const transporter = createTransport({
        host: this.config.host,
        port: this.config.port,
        secure: this.config.secure,
        auth: this.config.user !== undefined ? { user: this.config.user, pass: this.config.password } : undefined,
        connectionTimeout: timeoutMs,
        greetingTimeout: timeoutMs,
        socketTimeout: timeoutMs,
      } as Parameters<typeof nodemailer.createTransport>[0]);
      try {
        await transporter.sendMail({
          from: this.config.from,
          to: this.config.to,
          subject: msg.title,
          text: msg.body,
        });
      } catch {
        throw new Error('smtp: send failed (connection or delivery error)');
      } finally {
        transporter.close();
      }
    }, this.opts);
  }
}
