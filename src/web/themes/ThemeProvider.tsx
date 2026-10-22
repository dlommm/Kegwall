import type { ReactNode } from 'react';
import type { WallConfig } from '../../server/core/wallConfig.js';
import { resolveThemeTokens, getTheme } from './themes';
import { ensureContrast, flatten } from '../lib/contrast';

// Self-hosted fonts (no CDN): imported once from src/web/main.tsx (the app's
// unconditional entry chunk), not here — see main.tsx for why. themes.ts stays
// a plain, side-effect-free data module either way.

/**
 * Stable class name every wall's ThemeProvider scope element carries. Wall
 * `customCss` targets this selector (or a descendant of it) to override
 * tokens or style specific elements — it is guaranteed to be the last
 * stylesheet rendered for the scope, so equal-or-higher-specificity rules
 * there win the normal CSS cascade.
 */
export const THEME_SCOPE_CLASS = 'kegtron-theme-scope';

export interface ThemeProviderProps {
  /** A wall's `config.theme` (id + optional per-token overrides). Omitted -> taproom. */
  theme?: WallConfig['theme'];
  /** A wall's `config.customCss`, injected last so it wins the cascade. */
  customCss?: WallConfig['customCss'];
  /** Extra class(es) merged onto the scope element (e.g. layout classes). */
  className?: string;
  children: ReactNode;
}

function tokensToCss(tokens: Record<string, string>): string {
  const declarations = Object.entries(tokens)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join('\n');
  return `.${THEME_SCOPE_CLASS} {\n${declarations}\n}`;
}

/**
 * Kegwall V2 semantic inks, derived from the theme's own colors (and any overrides) so every
 * secondary line of text meets WCAG contrast on the theme's ground and surfaces: 4.5:1 for
 * secondary and caution text, 3:1 for tertiary (used only at large sizes). Colors that
 * aren't plain hex/rgb (a `var()` override, say) keep the CSS fallback in tokens.css.
 */
export function accessibleInks(tokens: Record<string, string>): Record<string, string> {
  const ground = tokens['--bg'];
  const ink = tokens['--text'];
  if (!ground || !ink) return {};
  const surface = tokens['--surface'] ? flatten(tokens['--surface'], ground) : ground;
  const bgs = surface ? [ground, surface] : [ground];
  const out: Record<string, string> = {};
  const set = (key: string, from: string | undefined, min: number) => {
    const c = from ? ensureContrast(from, bgs, ink, min) : null;
    if (c) out[key] = c;
  };
  set('--color-ink-2', tokens['--text-dim'], 4.5);
  set('--color-ink-3', tokens['--text-faint'], 3);
  set('--color-caution', tokens['--warn'], 4.5);
  set('--color-problem', tokens['--danger'], 4.5);
  set('--color-good', tokens['--ok'], 4.5);
  return out;
}

/**
 * Applies a wall's theme (built-in theme id + overrides) as CSS custom
 * properties on a scoping element, with the wall's optional raw `customCss`
 * injected last so it wins the cascade. Unknown theme ids fall back to
 * `taproom`.
 */
export function ThemeProvider({
  theme, customCss, className, children,
}: ThemeProviderProps) {
  const resolvedTheme = getTheme(theme?.id);
  const tokens = resolveThemeTokens(theme?.id, theme?.overrides);
  const cssTokens = { ...tokens, ...accessibleInks(tokens) };
  const scopeClassName = className ? `${THEME_SCOPE_CLASS} ${className}` : THEME_SCOPE_CLASS;

  return (
    <div className={scopeClassName} data-theme-id={resolvedTheme.id} data-theme-mode={resolvedTheme.mode}>
      <style>{tokensToCss(cssTokens)}</style>
      {customCss ? <style>{customCss}</style> : null}
      {children}
    </div>
  );
}
