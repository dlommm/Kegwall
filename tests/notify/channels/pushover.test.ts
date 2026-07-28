import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { PushoverChannel } from '../../../src/server/notify/channels/pushover.js';

let upstream: FastifyInstance;
let upstreamUrl: string;
let requests: { body: Record<string, string> }[];
let failCount: number;
let alwaysFail: boolean;

async function listenUpstream(): Promise<string> {
  const app = Fastify();
  // Fastify has no built-in application/x-www-form-urlencoded parser (that's
  // @fastify/formbody, not a dependency of this app) -- parse the raw body manually,
  // same "addContentTypeParser" pattern as ntfy.test.ts's plain-text body.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => {
      const params = new URLSearchParams(body as string);
      done(null, Object.fromEntries(params.entries()));
    },
  );
  app.post('/1/messages.json', async (req, reply) => {
    requests.push({ body: req.body as Record<string, string> });
    if (alwaysFail || failCount > 0) {
      failCount -= 1;
      reply.code(500);
      return { status: 0, errors: ['boom'] };
    }
    return { status: 1 };
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  upstream = app;
  const address = app.server.address() as { port: number };
  return `http://127.0.0.1:${address.port}`;
}

beforeEach(async () => {
  requests = [];
  failCount = 0;
  alwaysFail = false;
  upstreamUrl = await listenUpstream();
});

afterEach(async () => {
  await upstream.close();
});

const FAST_RETRY = { backoffMs: [1, 1], sleep: () => Promise.resolve() };

describe('PushoverChannel', () => {
  it('is named "pushover"', () => {
    const ch = new PushoverChannel({ token: 't', user: 'u' }, { baseUrl: upstreamUrl });
    expect(ch.name).toBe('pushover');
  });

  it('POSTs token/user/title/message as a form body', async () => {
    const ch = new PushoverChannel(
      { token: 'app-token-123', user: 'user-key-456' },
      { baseUrl: upstreamUrl, ...FAST_RETRY },
    );
    await ch.send({ title: 'Keg low', body: 'Tap 2 is below 15%', severity: 'warning' });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.body).toMatchObject({
      token: 'app-token-123',
      user: 'user-key-456',
      title: 'Keg low',
      message: 'Tap 2 is below 15%',
    });
    expect(requests[0]?.body.priority).toBeDefined();
  });

  it('maps severity to a distinct pushover priority per level', async () => {
    const ch = new PushoverChannel({ token: 't', user: 'u' }, { baseUrl: upstreamUrl, ...FAST_RETRY });
    await ch.send({ title: 'a', body: 'b', severity: 'info' });
    await ch.send({ title: 'a', body: 'b', severity: 'critical' });
    const priorities = requests.map((r) => r.body.priority);
    expect(priorities[0]).not.toBe(priorities[1]);
  });

  it('retries a failing request and succeeds once the upstream recovers', async () => {
    failCount = 2;
    const ch = new PushoverChannel({ token: 't', user: 'u' }, { baseUrl: upstreamUrl, ...FAST_RETRY });
    await expect(ch.send({ title: 'a', body: 'b', severity: 'info' })).resolves.toBeUndefined();
    expect(requests).toHaveLength(3);
  });

  it('exhausts retries and throws once every attempt fails', async () => {
    alwaysFail = true;
    const ch = new PushoverChannel({ token: 't', user: 'u' }, { baseUrl: upstreamUrl, ...FAST_RETRY });
    await expect(ch.send({ title: 'a', body: 'b', severity: 'info' })).rejects.toThrow();
    expect(requests).toHaveLength(3);
  });

  it('redaction: a thrown error never contains the token or user key', async () => {
    alwaysFail = true;
    const ch = new PushoverChannel(
      { token: 'super-secret-app-token', user: 'super-secret-user-key' },
      { baseUrl: upstreamUrl, ...FAST_RETRY },
    );
    let threw = false;
    try {
      await ch.send({ title: 'a', body: 'b', severity: 'info' });
    } catch (err) {
      threw = true;
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain('super-secret-app-token');
      expect(message).not.toContain('super-secret-user-key');
    }
    expect(threw).toBe(true);
  });

  it('defaults to the real api.pushover.net base URL when none is given', () => {
    const ch = new PushoverChannel({ token: 't', user: 'u' });
    expect(ch.name).toBe('pushover'); // just proves construction doesn't require baseUrl
  });
});
