import type { Settings } from '../../../../server/db/settings.js';
// A real VALUE import (not type-only) of a server `core/` module — see that file's doc
// comment for why this is safe under tsconfig.web.json (a dependency-free module, only a
// type import of db/settings.ts) and why it replaces what used to be a hand-duplicated
// local copy of this same constant.
import { SOURCE_RESTART_KEYS } from '../../../../server/core/restartKeys.js';

/**
 * Mirrors `settingsSchema`'s own defaults for `mqtt`'s sub-fields (`db/settings.ts`) —
 * needed here ONLY as a fallback for constructing a brand-new `mqtt` object from scratch
 * when it has never been configured (`settings.mqtt === null`). Once `mqtt` has been
 * configured at all, `GET /api/settings` always returns every sub-field already resolved
 * (`SettingsStore.all()`/`masked()` run the whole thing through `settingsSchema.parse`),
 * so this constant is never consulted after that first save. Can't import the real
 * `settingsSchema` value here instead — this repo's "types via type-only server imports"
 * rule (see Global Constraints) only clears VALUE imports of dependency-free `core/`
 * modules and plain `db/` modules for their TYPES, not for reaching into a zod schema's
 * runtime defaults.
 */
export const MQTT_DEFAULTS = {
  gen1TopicPrefix: 'home/TheengsGateway',
  haPublishEnabled: false,
  haDiscoveryPrefix: 'homeassistant',
  appTopicPrefix: 'kegwall',
};

export function triggersRestart(patch: Partial<Settings>): boolean {
  return Object.keys(patch).some((k) => SOURCE_RESTART_KEYS.includes(k as keyof Settings));
}

export interface GroupProps {
  settings: Settings;
  /** Bubbles the fresh, post-save canonical settings up to SettingsPage (so sibling
   * groups sharing `mqtt` — Sources and Integrations — see each other's latest values),
   * plus the exact patch body that was sent (so the page can decide whether to show the
   * restart notice). */
  onSaved: (updated: Settings, patch: Partial<Settings>) => void;
}
