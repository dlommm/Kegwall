import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SMTPServer } from 'smtp-server';
import type net from 'node:net';
import { SmtpChannel } from '../../../src/server/notify/channels/smtp.js';

// SMTP fake-upstream choice (Task 2 spec explicitly offers "nodemailer's JSON transport
// or a stub SMTP server -- justify choice"): a real local `smtp-server` instance (the
// nodemailer author's own companion package) is used instead of nodemailer's
// jsonTransport. jsonTransport never touches the network and always "succeeds" --
// it cannot exercise retry-then-succeed / retry-exhausted-throws at all, which this
// task's test matrix explicitly requires for every channel. A real local SMTP server is
// the same "fake upstream, real protocol, no mocking the network layer" choice already
// established by this repo's other channel tests (fake Fastify servers for the HTTP
// channels) and by `tests/ingest/mqttSource.test.ts` (a real local aedes MQTT broker).

let server: SMTPServer;
let port: number;
let received: { from: string; to: string[]; raw: string }[];
let failCount: number;
let alwaysFail: boolean;
let seenAuth: { username?: string; password?: string } | undefined;

function startServer(): Promise<number> {
  received = [];
  failCount = 0;
  alwaysFail = false;
  seenAuth = undefined;
  server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    logger: false,
    onAuth(auth, _session, callback) {
      seenAuth = { username: auth.username, password: auth.password };
      callback(null, { user: auth.username });
    },
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => {
        if (alwaysFail || failCount > 0) {
          failCount -= 1;
          callback(new Error('421 4.3.0 temporary failure, try again'));
          return;
        }
        received.push({
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '',
          to: session.envelope.rcptTo.map((r) => r.address),
          raw: Buffer.concat(chunks).toString('utf8'),
        });
        callback();
      });
    },
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.server.address() as net.AddressInfo;
      resolve(address.port);
    });
  });
}

beforeEach(async () => {
  port = await startServer();
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const FAST_RETRY = { backoffMs: [1, 1] as number[], sleep: () => Promise.resolve() };

describe('SmtpChannel', () => {
  it('is named "smtp"', () => {
    const ch = new SmtpChannel({
      host: '127.0.0.1', port, secure: false, from: 'kegtron@example.com', to: 'admin@example.com',
    });
    expect(ch.name).toBe('smtp');
  });

  it('sends an email with from/to/subject/text matching the message', async () => {
    const ch = new SmtpChannel(
      { host: '127.0.0.1', port, secure: false, from: 'kegtron@example.com', to: 'admin@example.com' },
      FAST_RETRY,
    );
    await ch.send({ title: 'Keg low', body: 'Tap 2 is below 15%', severity: 'warning' });
    expect(received).toHaveLength(1);
    expect(received[0]?.from).toBe('kegtron@example.com');
    expect(received[0]?.to).toEqual(['admin@example.com']);
    expect(received[0]?.raw).toContain('Subject: Keg low');
    expect(received[0]?.raw).toContain('Tap 2 is below 15%');
  });

  it('authenticates with the configured user/password when present', async () => {
    const ch = new SmtpChannel(
      {
        host: '127.0.0.1', port, secure: false, user: 'smtp-user', password: 'smtp-pass-123',
        from: 'kegtron@example.com', to: 'admin@example.com',
      },
      FAST_RETRY,
    );
    await ch.send({ title: 'a', body: 'b', severity: 'info' });
    expect(seenAuth?.username).toBe('smtp-user');
    expect(seenAuth?.password).toBe('smtp-pass-123');
  });

  it('retries a failing send and succeeds once the upstream recovers', async () => {
    failCount = 2;
    const ch = new SmtpChannel(
      { host: '127.0.0.1', port, secure: false, from: 'a@example.com', to: 'b@example.com' },
      FAST_RETRY,
    );
    await expect(ch.send({ title: 'a', body: 'b', severity: 'info' })).resolves.toBeUndefined();
    expect(received).toHaveLength(1);
  });

  it('exhausts retries and throws once every attempt fails', async () => {
    alwaysFail = true;
    const ch = new SmtpChannel(
      { host: '127.0.0.1', port, secure: false, from: 'a@example.com', to: 'b@example.com' },
      FAST_RETRY,
    );
    await expect(ch.send({ title: 'a', body: 'b', severity: 'info' })).rejects.toThrow();
    expect(received).toHaveLength(0);
  });

  it('redaction: a thrown error never contains the smtp password', async () => {
    alwaysFail = true;
    const ch = new SmtpChannel(
      {
        host: '127.0.0.1', port, secure: false, user: 'smtp-user', password: 'super-secret-smtp-password',
        from: 'a@example.com', to: 'b@example.com',
      },
      FAST_RETRY,
    );
    let threw = false;
    try {
      await ch.send({ title: 'a', body: 'b', severity: 'info' });
    } catch (err) {
      threw = true;
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain('super-secret-smtp-password');
    }
    expect(threw).toBe(true);
  });
});
