import { describe, it, expect, beforeEach } from 'vitest';
import {
  ADMIN_THEMES, getAdminTheme, loadAdminThemeId, saveAdminThemeId,
} from '../../src/web/lib/adminTheme';
import { resolveThemeTokens } from '../../src/web/themes/themes';

describe('adminTheme (design 5a/8h/8i admin looks)', () => {
  // This environment's jsdom exposes a non-functional window.localStorage
  // (Node's own shim collides with it) — install a real Map-backed stub.
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

  it('ships the three looks with midnight as the default', () => {
    expect(ADMIN_THEMES.map((t) => t.id)).toEqual(['midnight', 'workshop', 'console']);
    expect(getAdminTheme(null).id).toBe('midnight');
    expect(getAdminTheme('nonsense').id).toBe('midnight');
  });

  it('midnight resolves the design 5a admin surfaces', () => {
    const midnight = getAdminTheme('midnight');
    const tokens = resolveThemeTokens(midnight.theme.id, midnight.theme.overrides);
    expect(tokens['--bg']).toBe('#101418');
    expect(tokens['--admin-sidebar']).toBe('#0C0F13');
    expect(tokens['--surface']).toBe('#161B21');
    expect(tokens['--accent']).toBe('#D08C4C');
  });

  it('console swaps to the terminal green + mono identity (8i)', () => {
    const consoleTheme = getAdminTheme('console');
    const tokens = resolveThemeTokens(consoleTheme.theme.id, consoleTheme.theme.overrides);
    expect(tokens['--bg']).toBe('#0A0A0A');
    expect(tokens['--accent']).toBe('#4AF07A');
    expect(tokens['--font-body']).toContain('IBM Plex Mono');
  });

  it('workshop is the light look (8h)', () => {
    const workshop = getAdminTheme('workshop');
    const tokens = resolveThemeTokens(workshop.theme.id, workshop.theme.overrides);
    expect(tokens['--bg']).toBe('#F5F2EC');
    expect(tokens['--surface']).toBe('#FFFFFF');
  });

  it('persists the selection in localStorage, defaulting when absent/garbage', () => {
    expect(loadAdminThemeId()).toBe('midnight');
    saveAdminThemeId('console');
    expect(loadAdminThemeId()).toBe('console');
    window.localStorage.setItem('kegtron.adminTheme', 'bogus');
    expect(loadAdminThemeId()).toBe('midnight');
  });
});
