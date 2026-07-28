import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { DiscordChannel } from '../../../src/server/notify/channels/discord.js';

let upstream: FastifyInstance;
let upstreamUrl: string;
let webhookUrl: string;
let requests: { body: any }[];
let failCount: number;
let alwaysFail: boolean;

async function listenUpstream(): Promise<string> {
  const app = Fastify();
  app.post('/api/webhooks/123/secret-token-abc', async (req, reply) => {
    requests.push({ body: req.body });
    if (alwaysFail || failCount > 0) {
      failCount -= 1;
      reply.code(500);
      return { message: 'boom' };
    }
    reply.code(204);
    return '';
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
  webhookUrl = `${upstreamUrl}/api/webhooks/123/secret-token-abc`;
});

afterEach(async () => {
  await upstream.close();
});

const FAST_RETRY = { backoffMs: [1, 1], sleep: () => Promise.resolve() };

describe('DiscordChannel', () => {
  it('is named "discord"', () => {
    const ch = new DiscordChannel({ webhookUrl });
    expect(ch.name).toBe('discord');
  });

  it('POSTs a JSON embed with title/description', async () => {
    const ch = new DiscordChannel({ webhookUrl }, FAST_RETRY);
    await ch.send({ title: 'Keg low', body: 'Tap 2 is below 15%', severity: 'warning' });
    expect(requests).toHaveLength(1);
    const embed = requests[0]?.body?.embeds?.[0];
    expect(embed.title).toBe('Keg low');
    expect(embed.description).toBe('Tap 2 is below 15%');
    expect(typeof embed.color).toBe('number');
  });

  it('maps severity to a distinct embed color per level', async () => {
    const ch = new DiscordChannel({ webhookUrl }, FAST_RETRY);
    await ch.send({ title: 'a', body: 'b', severity: 'info' });
    await ch.send({ title: 'a', body: 'b', severity: 'critical' });
    const colors = requests.map((r) => r.body.embeds[0].color);
    expect(colors[0]).not.toBe(colors[1]);
  });

  it('retries a failing request and succeeds once the upstream recovers', async () => {
    failCount = 2;
    const ch = new DiscordChannel({ webhookUrl }, FAST_RETRY);
    await expect(ch.send({ title: 'a', body: 'b', severity: 'info' })).resolves.toBeUndefined();
    expect(requests).toHaveLength(3);
  });

  it('exhausts retries and throws once every attempt fails', async () => {
    alwaysFail = true;
    const ch = new DiscordChannel({ webhookUrl }, FAST_RETRY);
    await expect(ch.send({ title: 'a', body: 'b', severity: 'info' })).rejects.toThrow();
    expect(requests).toHaveLength(3);
  });

  it('redaction: a thrown error never contains the full webhook URL (embedded token)', async () => {
    alwaysFail = true;
    const ch = new DiscordChannel({ webhookUrl }, FAST_RETRY);
    let threw = false;
    try {
      await ch.send({ title: 'a', body: 'b', severity: 'info' });
    } catch (err) {
      threw = true;
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain('secret-token-abc');
      expect(message).not.toContain(webhookUrl);
    }
    expect(threw).toBe(true);
  });
});
