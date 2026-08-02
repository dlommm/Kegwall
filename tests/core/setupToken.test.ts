import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ensureSetupClaimToken, readSetupClaimToken, setupTokenMatches, consumeSetupClaimToken,
} from '../../src/server/core/setupToken.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ktdash-')); });

describe('setupToken', () => {
  it('writes a random 0600 token file and is idempotent across calls', () => {
    const t1 = ensureSetupClaimToken(dir);
    expect(t1).toMatch(/^[0-9a-f]{48}$/);
    expect(existsSync(join(dir, 'setup-claim-token'))).toBe(true);
    // Idempotent — a second boot reuses the same token the operator already copied.
    expect(ensureSetupClaimToken(dir)).toBe(t1);
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, 'setup-claim-token')).mode & 0o777).toBe(0o600);
    }
  });

  it('matches the staged token (constant-time) and rejects wrong/empty/absent tokens', () => {
    const token = ensureSetupClaimToken(dir);
    expect(setupTokenMatches(dir, token)).toBe(true);
    expect(setupTokenMatches(dir, 'wrong')).toBe(false);
    expect(setupTokenMatches(dir, undefined)).toBe(false);
    expect(setupTokenMatches(dir, `${token}extra`)).toBe(false);
  });

  it('consume deletes the token so it can never be reused', () => {
    const token = ensureSetupClaimToken(dir);
    consumeSetupClaimToken(dir);
    expect(readSetupClaimToken(dir)).toBeNull();
    expect(setupTokenMatches(dir, token)).toBe(false);
    expect(() => consumeSetupClaimToken(dir)).not.toThrow(); // idempotent
  });

  it('readSetupClaimToken returns the raw token contents', () => {
    const token = ensureSetupClaimToken(dir);
    expect(readSetupClaimToken(dir)).toBe(token);
    expect(readFileSync(join(dir, 'setup-claim-token'), 'utf8').trim()).toBe(token);
  });
});
