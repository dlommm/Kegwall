import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../src/server/db/db.js';
import { EventBus } from '../../../src/server/core/events.js';
import { listNotifications } from '../../../src/server/db/notificationsRepo.js';
import { createAutomation } from '../../../src/server/db/automations.js';
import { InAppChannel } from '../../../src/server/notify/channels/inApp.js';

let db: ReturnType<typeof openDb>;
let bus: EventBus;
let channel: InAppChannel;

beforeEach(() => {
  db = openDb(mkdtempSync(join(tmpdir(), 'ktdash-')));
  bus = new EventBus();
  channel = new InAppChannel(db, bus);
});

describe('InAppChannel', () => {
  it('is named "inApp"', () => {
    expect(channel.name).toBe('inApp');
  });

  it('inserts a notification row via notificationsRepo', async () => {
    await channel.send({ title: 'Keg low', body: 'Tap 2 is below 15%', severity: 'warning' });
    const rows = listNotifications(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: 'Keg low', body: 'Tap 2 is below 15%', severity: 'warning', acked: false, automationId: null,
    });
  });

  it('links the notification to meta.automationId when present', async () => {
    // notifications.automation_id is a real FK (see notificationsRepo.ts) -- a real row
    // has to exist first, unlike the "unlinked" cases above which pass no automationId.
    const rule = createAutomation(db, { name: 'Keg low', trigger: { type: 'keg_kicked' } });
    await channel.send({ title: 'x', body: 'y', severity: 'info', meta: { automationId: rule.id } });
    const rows = listNotifications(db);
    expect(rows[0]?.automationId).toBe(rule.id);
  });

  it('ignores a non-numeric meta.automationId (stores null rather than throwing)', async () => {
    await channel.send({ title: 'x', body: 'y', severity: 'info', meta: { automationId: 'not-a-number' } });
    const rows = listNotifications(db);
    expect(rows[0]?.automationId).toBeNull();
  });

  it('emits a state_changed bus event scoped to notifications', async () => {
    const seen: { scope: string; ts: string }[] = [];
    bus.on('state_changed', (e) => seen.push(e));
    await channel.send({ title: 'x', body: 'y', severity: 'critical' });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.scope).toBe('notifications');
    expect(typeof seen[0]?.ts).toBe('string');
  });

  it('does not emit any other scope', async () => {
    const seen: string[] = [];
    bus.on('state_changed', (e) => seen.push(e.scope));
    await channel.send({ title: 'x', body: 'y', severity: 'info' });
    expect(seen).toEqual(['notifications']);
  });
});
