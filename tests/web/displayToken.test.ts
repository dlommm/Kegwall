import { describe, it, expect, beforeEach } from 'vitest';
import {
  getDisplayToken, setDisplayToken, clearDisplayToken, withDisplayTokenQuery,
} from '../../src/web/lib/displayToken';

// This environment's jsdom exposes a non-functional window.localStorage (Node's own shim
// collides with it) — install a real Map-backed stub.
beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
    },
  });
});

describe('displayToken storage', () => {
  it('stores, reads, and clears the token', () => {
    expect(getDisplayToken()).toBeNull();
    setDisplayToken('abc123');
    expect(getDisplayToken()).toBe('abc123');
    clearDisplayToken();
    expect(getDisplayToken()).toBeNull();
  });

  it('withDisplayTokenQuery appends ?displayToken= only when a token is stored', () => {
    expect(withDisplayTokenQuery('ws://host/ws')).toBe('ws://host/ws'); // unpaired → untouched
    setDisplayToken('tok');
    expect(withDisplayTokenQuery('ws://host/ws')).toBe('ws://host/ws?displayToken=tok');
    expect(withDisplayTokenQuery('ws://host/ws?wall=main')).toBe('ws://host/ws?wall=main&displayToken=tok');
  });

  it('url-encodes the token', () => {
    setDisplayToken('a b/c');
    expect(withDisplayTokenQuery('/ws')).toBe('/ws?displayToken=a%20b%2Fc');
  });
});
