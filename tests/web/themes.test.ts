import { describe, it, expect } from 'vitest';
import {
  THEMES, DEFAULT_THEME_ID, getTheme, resolveThemeTokens, themePreview,
} from '../../src/web/themes/themes';

const REQUIRED_TOKEN_KEYS = [
  '--bg',
  '--surface',
  '--text',
  '--text-dim',
  '--text-faint',
  '--accent',
  '--border',
  '--border-strong',
  '--ok',
  '--warn',
  '--danger',
  '--card-radius',
  '--font-display',
  '--font-body',
  '--font-mono-numeric',
];

const REDESIGN_IDS = ['midnight-slate', 'cream', 'cellar-teal', 'taproom-green', 'amber-glow', 'arcade'];
const LEGACY_IDS = ['taproom', 'chalkboard', 'bright', 'mono'];

describe('themes', () => {
  it('ships the six redesign themes plus the four legacy themes', () => {
    const ids = THEMES.map((t) => t.id).sort();
    expect(ids).toEqual([...REDESIGN_IDS, ...LEGACY_IDS].sort());
  });

  it('defaults to midnight-slate', () => {
    expect(DEFAULT_THEME_ID).toBe('midnight-slate');
    expect(THEMES.some((t) => t.id === 'midnight-slate')).toBe(true);
  });

  it.each([...REDESIGN_IDS, ...LEGACY_IDS])('%s defines every required token', (id) => {
    const theme = getTheme(id);
    for (const key of REQUIRED_TOKEN_KEYS) {
      expect(theme.tokens[key], `${id} is missing token ${key}`).toBeTruthy();
    }
  });

  it('midnight-slate carries the flagship design tokens', () => {
    const tokens = getTheme('midnight-slate').tokens;
    expect(tokens['--bg']).toBe('#0F1216');
    expect(tokens['--text']).toBe('#E9EDF1');
    expect(tokens['--text-dim']).toBe('#93A0AC');
    expect(tokens['--accent']).toBe('#D08C4C');
    expect(tokens['--ok']).toBe('#57B45F');
    expect(tokens['--warn']).toBe('#E5B84A');
    expect(tokens['--danger']).toBe('#E05B4B');
    expect(tokens['--font-display']).toContain('Big Shoulders Display');
    expect(tokens['--font-body']).toContain('Atkinson Hyperlegible');
  });

  it('redesign themes carry the design-doc background/accent hexes', () => {
    expect(getTheme('cream').tokens['--bg']).toBe('#F4F1EB');
    expect(getTheme('cream').tokens['--accent']).toBe('#B4622D');
    expect(getTheme('cellar-teal').tokens['--bg']).toBe('#0A0D12');
    expect(getTheme('cellar-teal').tokens['--accent']).toBe('#5FD9BC');
    expect(getTheme('taproom-green').tokens['--bg']).toBe('#12211B');
    expect(getTheme('taproom-green').tokens['--accent']).toBe('#E7B93F');
    expect(getTheme('amber-glow').tokens['--bg']).toBe('#1A120C');
    expect(getTheme('amber-glow').tokens['--accent']).toBe('#E0A83D');
    expect(getTheme('arcade').tokens['--bg']).toBe('#0D0B14');
    expect(getTheme('arcade').tokens['--accent']).toBe('#B48CFF');
  });

  it('legacy themes keep their original core tokens so stored walls render unchanged', () => {
    expect(getTheme('taproom').tokens['--bg']).toBe('#19140F');
    expect(getTheme('taproom').tokens['--accent']).toBe('#C9972B');
    expect(getTheme('taproom').tokens['--font-display']).toContain('Big Shoulders Display');
    expect(getTheme('chalkboard').tokens['--bg']).toBe('#1E2422');
    expect(getTheme('bright').tokens['--bg']).toBe('#F7F4EE');
    expect(getTheme('mono').tokens['--bg']).toBe('#0A0A0A');
  });

  it('every theme has a distinct id and a human-readable name', () => {
    const ids = new Set(THEMES.map((t) => t.id));
    expect(ids.size).toBe(THEMES.length);
    for (const theme of THEMES) {
      expect(theme.name.length).toBeGreaterThan(0);
    }
  });

  it('getTheme returns the matching theme by id', () => {
    expect(getTheme('mono').id).toBe('mono');
    expect(getTheme('cream').id).toBe('cream');
  });

  it('getTheme falls back to midnight-slate for an unknown id', () => {
    expect(getTheme('nonexistent-theme').id).toBe('midnight-slate');
    expect(getTheme(undefined).id).toBe('midnight-slate');
    expect(getTheme('').id).toBe('midnight-slate');
  });

  it('resolveThemeTokens returns the theme tokens unchanged with no overrides', () => {
    const tokens = resolveThemeTokens('mono');
    expect(tokens).toEqual(getTheme('mono').tokens);
  });

  it('resolveThemeTokens applies overrides on top of the base theme tokens', () => {
    const tokens = resolveThemeTokens('bright', { '--accent': '#123456' });
    expect(tokens['--accent']).toBe('#123456');
    // Unrelated tokens are untouched.
    expect(tokens['--bg']).toBe(getTheme('bright').tokens['--bg']);
  });

  it('resolveThemeTokens ignores overrides with unsafe keys or values', () => {
    const base = getTheme('taproom').tokens['--accent'];
    const tokens = resolveThemeTokens('taproom', {
      // not a custom-property name
      color: 'red',
      // attempts to break out of a CSS declaration
      '--accent': 'red; } .evil { color: red',
    });
    expect(tokens['--accent']).toBe(base);
    expect(tokens.color).toBeUndefined();
  });

  it('resolveThemeTokens falls back to midnight-slate tokens for an unknown theme id', () => {
    expect(resolveThemeTokens('nonexistent-theme')).toEqual(getTheme('midnight-slate').tokens);
  });
});

describe('theme registry (Kegwall V2)', () => {
  it('marks the light grounds as light and every other theme as dark', () => {
    const light = THEMES.filter((t) => t.mode === 'light').map((t) => t.id).sort();
    expect(light).toEqual(['bright', 'cream']);
    expect(THEMES.every((t) => t.mode === 'light' || t.mode === 'dark')).toBe(true);
  });

  it('previews a theme from its own tokens', () => {
    const t = getTheme('cream');
    expect(themePreview(t)).toEqual({
      ground: t.tokens['--bg'], surface: t.tokens['--surface'], ink: t.tokens['--text'], accent: t.tokens['--accent'],
    });
  });
});
