import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { sendWebhook } from '../../src/server/notify/webhookSender.js';

// `sendWebhook` is the standalone sender Task 3's engine will call for a rule's
// `{type: 'webhook'}` action -- per `core/automationSchema.ts`'s `ActionSchema`, that
// action carries `url` + `bodyTemplate: string`, i.e. the caller has ALREADY rendered
// the template (via `renderTemplate`) into a plain string before calling `sendWebhook`;
// this sender's job is only "POST these exact bytes", not templating or JSON-encoding
// them again. It's a per-automation-action URL, NOT one of the settings-configured
// `alertChannels` -- no `Channel` wrapper, no send-test route entry; exercised directly.

let upstream: FastifyInstance;
let upstreamUrl: string;
let requests: { headers: Record<string, unknown>; body: unknown }[];
let failCount: number;
let alwaysFail: boolean;

async function listenUpstream(): Promise<string> {
  const app = Fastify();
  app.post('/hook', async (req, reply) => {
    requests.push({ headers: req.headers as any, body: req.body });
    if (alwaysFail || failCount > 0) {
      failCount -= 1;
      reply.code(500);
      return { error: 'boom' };
    }
    return { ok: true };
  });
  app.post('/slow-hook', async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
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

describe('sendWebhook', () => {
  it('POSTs the given body string as JSON with a content-type header', async () => {
    await sendWebhook(`${upstreamUrl}/hook`, '{"text":"Tap 2 is below 15%"}', FAST_RETRY);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.body).toEqual({ text: 'Tap 2 is below 15%' });
    expect(requests[0]?.headers['content-type']).toContain('application/json');
  });

  it('sends the body verbatim -- no re-templating or re-encoding', async () => {
    await sendWebhook(`${upstreamUrl}/hook`, '{"raw":"exact bytes"}', FAST_RETRY);
    expect(requests[0]?.body).toEqual({ raw: 'exact bytes' });
  });

  it('retries a failing request and succeeds once the upstream recovers', async () => {
    failCount = 2;
    await expect(sendWebhook(`${upstreamUrl}/hook`, '{}', FAST_RETRY)).resolves.toBeUndefined();
    expect(requests).toHaveLength(3);
  });

  it('exhausts retries and throws once every attempt fails', async () => {
    alwaysFail = true;
    await expect(sendWebhook(`${upstreamUrl}/hook`, '{}', FAST_RETRY)).rejects.toThrow();
    expect(requests).toHaveLength(3);
  });

  it('redaction: a thrown error never contains the target URL', async () => {
    alwaysFail = true;
    const url = `${upstreamUrl}/hook?token=super-secret-query-token`;
    let threw = false;
    try {
      await sendWebhook(url, '{}', FAST_RETRY);
    } catch (err) {
      threw = true;
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain('super-secret-query-token');
      expect(message).not.toContain(url);
    }
    expect(threw).toBe(true);
  });

  it('honors a shorter timeoutMs against a slow upstream (times out and throws)', async () => {
    await expect(
      sendWebhook(`${upstreamUrl}/slow-hook`, '{}', { timeoutMs: 20, backoffMs: [], sleep: () => Promise.resolve() }),
    ).rejects.toThrow();
  });
});
