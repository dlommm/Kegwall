import { describe, it, expect } from 'vitest';
import { SOURCE_RESTART_KEYS } from '../../src/server/core/restartKeys.js';

describe('SOURCE_RESTART_KEYS', () => {
  it('lists exactly the settings keys that live-restart ingest sources', () => {
    expect([...SOURCE_RESTART_KEYS].sort()).toEqual(
      ['bleDirectEnabled', 'kegtronApiKey', 'mqtt', 'udpEnabled'].sort(),
    );
  });
});
