import type Database from 'better-sqlite3';
import type { EventBus } from '../../core/events.js';
import { insertNotification } from '../../db/notificationsRepo.js';
import type { Channel, ChannelMessage } from './types.js';

/**
 * The one Channel that never touches the network: writes a row to the `notifications`
 * table (Task 1's repo) and nudges the admin UI via `state_changed {scope:
 * 'notifications'}` -- the WS layer that turns this into a bell-badge update is Task 4's
 * job (this file only emits the bus event; see `core/events.ts`'s `EventMap`, which
 * already reserves the `'notifications'` scope for exactly this).
 *
 * No timeout/retry (Task 2 spec's "5s timeout, 2 retries" applies to EXTERNAL senders --
 * a local synchronous-ish DB write has no network failure mode to retry against; a thrown
 * `better-sqlite3` error here is a genuine bug, not a transient failure).
 */
export class InAppChannel implements Channel {
  readonly name = 'inApp' as const;

  constructor(private readonly db: Database.Database, private readonly bus: EventBus) {}

  async send(msg: ChannelMessage): Promise<void> {
    const automationId = typeof msg.meta?.automationId === 'number' ? msg.meta.automationId : null;
    insertNotification(this.db, {
      automationId,
      severity: msg.severity,
      title: msg.title,
      body: msg.body,
    });
    this.bus.emit('state_changed', { scope: 'notifications', ts: new Date().toISOString() });
  }
}
