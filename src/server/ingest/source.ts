import type { EventMap } from '../core/events.js';

// SourceName mirrors the `source_status` event's source field union in events.ts —
// derived (not redeclared) so the two can never drift apart.
export type SourceName = EventMap['source_status']['source'];

export interface Source {
  readonly name: SourceName;
  start(): Promise<void>;
  stop(): Promise<void>;
}
