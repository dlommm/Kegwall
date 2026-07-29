import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { SlackChannel } from '../../../src/server/notify/channels/slack.js';

let upstream: FastifyInstance;
let upstreamUrl: string;
let webhookUrl: string;
let requests: { body: any }[];
let failCount: number;
let alwaysFail: boolean;

async function listenUpstream(): Promise<string> {
  const app = Fastify();
  app.post('/services/T00/B00/secret-token-xyz', async (req, reply) => {
    requests.push({ body: req.body });
    if (alwaysFail || failCount > 0) {
      failCount -= 1;
      reply.code(500);
      return 'boom';
    }
    return 'ok';
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
  webhookUrl = `${upstreamUrl}/services/T00/B00/secret-token-xyz`;
});

afterEach(async () => {
  await upstream.close();
});

const FAST_RETRY = { backoffMs: [1, 1], sleep: () => Promise.resolve() };

describe('SlackChannel', () => {
  it('is named "slack"', () => {
    const ch = new SlackChannel({ webhookUrl });
    expect(ch.name).toBe('slack');
  });

  it('POSTs Block Kit blocks with the title as a header and body as a section', async () => {
    const ch = new SlackChannel({ webhookUrl }, FAST_RETRY);
    await ch.send({ title: 'Keg low', body: 'Tap 2 is below 15%', severity: 'warning' });
    expect(requests).toHaveLength(1);
    const blocks = requests[0]?.body?.blocks;
    expect(Array.isArray(blocks)).toBe(true);
    const header = blocks.find((b: any) => b.type === 'header');
    const section = blocks.find((b: any) => b.type === 'section');
    expect(header.text.text).toBe('Keg low');
    expect(section.text.text).toBe('Tap 2 is below 15%');
  });

  it('retries a failing request and succeeds once the upstream recovers', async () => {
    failCount = 2;
    const ch = new SlackChannel({ webhookUrl }, FAST_RETRY);
    await expect(ch.send({ title: 'a', body: 'b', severity: 'info' })).resolves.toBeUndefined();
    expect(requests).toHaveLength(3);
  });

  it('exhausts retries and throws once every attempt fails', async () => {
    alwaysFail = true;
    const ch = new SlackChannel({ webhookUrl }, FAST_RETRY);
    await expect(ch.send({ title: 'a', body: 'b', severity: 'info' })).rejects.toThrow();
    expect(requests).toHaveLength(3);
  });

  it('redaction: a thrown error never contains the full webhook URL (embedded token)', async () => {
    alwaysFail = true;
    const ch = new SlackChannel({ webhookUrl }, FAST_RETRY);
    let threw = false;
    try {
      await ch.send({ title: 'a', body: 'b', severity: 'info' });
    } catch (err) {
      threw = true;
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain('secret-token-xyz');
      expect(message).not.toContain(webhookUrl);
    }
    expect(threw).toBe(true);
  });
});
