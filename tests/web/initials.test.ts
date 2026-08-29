import { describe, it, expect } from 'vitest';
import { initials } from '../../src/web/lib/initials';

describe('initials', () => {
  it('takes the first letter of the first and last words', () => {
    expect(initials('Sam Lee')).toBe('SL');
    expect(initials('Ada Mary Lovelace')).toBe('AL');
  });

  it('uses a single letter for one-word names', () => {
    expect(initials('Sam')).toBe('S');
  });

  it('uppercases lowercase input', () => {
    expect(initials('sam lee')).toBe('SL');
  });

  it('tolerates extra whitespace', () => {
    expect(initials('  Sam   Lee  ')).toBe('SL');
  });

  it('falls back to ? for empty/whitespace-only names', () => {
    expect(initials('')).toBe('?');
    expect(initials('   ')).toBe('?');
  });
});
