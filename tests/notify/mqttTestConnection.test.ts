import { describe, it, expect, afterEach } from 'vitest';
import net from 'node:net';
import { Aedes } from 'aedes';
import { testMqttConnection } from '../../src/server/notify/mqttSender.js';

// Real local aedes broker, same pattern as mqttSender.test.ts.

let broker: Aedes | undefined;
let server: net.Server | undefined;

async function startBroker(authenticate?: Aedes['authenticate']): Promise<number> {
  broker = await Aedes.createBroker();
  if (authenticate) broker.authenticate = authenticate;
  server = net.createServer(broker.handle);
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  return (server!.address() as { port: number }).port;
}

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  if (broker) await new Promise<void>((resolve) => broker!.close(() => resolve()));
  server = undefined; broker = undefined;
});

describe('testMqttConnection', () => {
  it('reports ok when the broker accepts the connection', async () => {
    const port = await startBroker();
    const res = await testMqttConnection({ url: `mqtt://127.0.0.1:${port}` }, { timeoutMs: 2000 });
    expect(res.ok).toBe(true);
    expect(res.detail.toLowerCase()).toContain('connected');
  });

  it('reports a credentials failure when the broker rejects auth', async () => {
    const port = await startBroker((_client, _username, _password, cb) => cb(null, false));
    const res = await testMqttConnection(
      { url: `mqtt://127.0.0.1:${port}`, username: 'u', password: 'bad' }, { timeoutMs: 2000 },
    );
    expect(res.ok).toBe(false);
    expect(res.detail.toLowerCase()).toContain('credential');
  });

  it('reports a refused/unreachable failure for a dead port', async () => {
    // Grab an ephemeral port then release it, so nothing is listening there.
    const probe = net.createServer();
    await new Promise<void>((resolve) => probe.listen(0, resolve));
    const deadPort = (probe.address() as { port: number }).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    const res = await testMqttConnection({ url: `mqtt://127.0.0.1:${deadPort}` }, { timeoutMs: 2000 });
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/refused|connect/i);
  });

  it('never rejects — always resolves { ok, detail }', async () => {
    const res = await testMqttConnection({ url: 'not-a-valid-url' }, { timeoutMs: 500 });
    expect(res.ok).toBe(false);
    expect(typeof res.detail).toBe('string');
  });
});
