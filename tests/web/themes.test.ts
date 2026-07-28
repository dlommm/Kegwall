import { describe, it, expect } from 'vitest';
import {
  THEMES, DEFAULT_THEME_ID, getTheme, resolveThemeTokens,
} from '../../src/web/themes/themes';

const REQUIRED_TOKEN_KEYS = [
  '--bg',
  '--surface',
  '--text',
  '--text-dim',
  '--accent',
  '--card-radius',
  '--font-display',
  '--font-body',
  '--font-mono-numeric',
];

describe('themes', () => {
  it('ships exactly the four built-in themes from the design direction', () => {
    const ids = THEMES.map((t) => t.id).sort();
    expect(ids).toEqual(['bright', 'chalkboard', 'mono', 'taproom']);
  });

  it('defaults to taproom', () => {
    expect(DEFAULT_THEME_ID).toBe('taproom');
    expect(THEMES.some((t) => t.id === 'taproom')).toBe(true);
  });

  it.each(['taproom', 'chalkboard', 'bright', 'mono'])('%s defines every required token', (id) => {
    const theme = getTheme(id);
    for (const key of REQUIRED_TOKEN_KEYS) {
      expect(theme.tokens[key], `${id} is missing token ${key}`).toBeTruthy();
    }
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
    expect(getTheme('bright').id).toBe('bright');
  });

  it('getTheme falls back to taproom for an unknown id', () => {
    expect(getTheme('nonexistent-theme').id).toBe('taproom');
    expect(getTheme(undefined).id).toBe('taproom');
    expect(getTheme('').id).toBe('taproom');
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

  it('resolveThemeTokens falls back to taproom tokens for an unknown theme id', () => {
    expect(resolveThemeTokens('nonexistent-theme')).toEqual(getTheme('taproom').tokens);
  });
});
