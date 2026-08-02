import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { NtfyChannel } from '../../../src/server/notify/channels/ntfy.js';

// Fake local ntfy server, per this repo's established "never call the real third-party
// service from a test" convention (see tests/routes/lookup.test.ts / mdashClient.test.ts).

let upstream: FastifyInstance;
let upstreamUrl: string;
let requests: { path: string; headers: Record<string, unknown>; body: string }[];
let failCount: number; // how many requests to fail (500) before succeeding, per test
let alwaysFail: boolean;

async function listenUpstream(): Promise<string> {
  const app = Fastify();
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
  app.post('/:topic', async (req, reply) => {
    const body = (req.body as Buffer).toString('utf8');
    requests.push({ path: (req.params as any).topic, headers: req.headers as any, body });
    if ((req.params as any).topic === 'slow') {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return { ok: true };
    }
    if ((req.params as any).topic === 'redirect') {
      reply.code(307).header('location', '/followed-elsewhere');
      return '';
    }
    if (alwaysFail || failCount > 0) {
      failCount -= 1;
      reply.code(500);
      return { error: 'boom' };
    }
    return { ok: true };
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

describe('NtfyChannel', () => {
  it('is named "ntfy"', () => {
    const ch = new NtfyChannel({ serverUrl: upstreamUrl, topic: 'alerts' });
    expect(ch.name).toBe('ntfy');
  });

  it('POSTs the message body to {serverUrl}/{topic} with Title/Priority headers', async () => {
    const ch = new NtfyChannel({ serverUrl: upstreamUrl, topic: 'taproom-alerts' }, FAST_RETRY);
    await ch.send({ title: 'Keg low', body: 'Tap 2 is below 15%', severity: 'warning' });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.path).toBe('taproom-alerts');
    expect(requests[0]?.body).toBe('Tap 2 is below 15%');
    expect(requests[0]?.headers.title).toBe('Keg low');
    expect(requests[0]?.headers.priority).toBeDefined();
  });

  it('maps severity to a distinct ntfy priority per level', async () => {
    const ch = new NtfyChannel({ serverUrl: upstreamUrl, topic: 't' }, FAST_RETRY);
    await ch.send({ title: 'a', body: 'b', severity: 'info' });
    await ch.send({ title: 'a', body: 'b', severity: 'warning' });
    await ch.send({ title: 'a', body: 'b', severity: 'critical' });
    const priorities = requests.map((r) => r.headers.priority);
    expect(new Set(priorities).size).toBe(3);
  });

  it('tolerates a trailing slash on serverUrl', async () => {
    const ch = new NtfyChannel({ serverUrl: `${upstreamUrl}/`, topic: 'x' }, FAST_RETRY);
    await ch.send({ title: 'a', body: 'b', severity: 'info' });
    expect(requests[0]?.path).toBe('x');
  });

  it('retries a failing request and succeeds once the upstream recovers', async () => {
    failCount = 2; // fail first 2 attempts, succeed on the 3rd (== 2 retries)
    const sleep = vi.fn().mockResolvedValue(undefined);
    const ch = new NtfyChannel({ serverUrl: upstreamUrl, topic: 'x' }, { backoffMs: [1, 1], sleep });
    await expect(ch.send({ title: 'a', body: 'b', severity: 'info' })).resolves.toBeUndefined();
    expect(requests).toHaveLength(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('exhausts retries and throws once every attempt fails', async () => {
    alwaysFail = true;
    const ch = new NtfyChannel({ serverUrl: upstreamUrl, topic: 'x' }, FAST_RETRY);
    await expect(ch.send({ title: 'a', body: 'b', severity: 'info' })).rejects.toThrow();
    expect(requests).toHaveLength(3); // 1 initial + 2 retries
  });

  it('redaction: a thrown error never contains the server URL or topic', async () => {
    alwaysFail = true;
    const ch = new NtfyChannel({ serverUrl: upstreamUrl, topic: 'secret-topic-name' }, FAST_RETRY);
    let threw = false;
    try {
      await ch.send({ title: 'a', body: 'b', severity: 'info' });
    } catch (err) {
      threw = true;
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain(upstreamUrl);
      expect(message).not.toContain('secret-topic-name');
    }
    expect(threw).toBe(true);
  });

  it('rejects a redirect response instead of following it (SSRF closure)', async () => {
    const ch = new NtfyChannel({ serverUrl: upstreamUrl, topic: 'redirect' }, FAST_RETRY);
    await expect(ch.send({ title: 'a', body: 'b', severity: 'info' })).rejects.toThrow();
  });

  it('honors a shorter timeoutMs against a slow upstream', async () => {
    const ch = new NtfyChannel(
      { serverUrl: upstreamUrl, topic: 'slow' },
      { timeoutMs: 20, backoffMs: [], sleep: () => Promise.resolve() },
    );
    await expect(ch.send({ title: 'a', body: 'b', severity: 'info' })).rejects.toThrow();
  });
});
