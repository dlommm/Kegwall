import type { ReactNode } from 'react';
import type { WallConfig } from '../../server/core/wallConfig.js';
import { resolveThemeTokens, getTheme } from './themes';

// Self-hosted fonts (no CDN) — see the task report for why these two faces
// were picked. Importing here (the theme layer, always mounted alongside
// ThemeProvider) rather than in themes.ts keeps themes.ts a plain, side-effect
// -free data module.
import '@fontsource-variable/oswald';
import '@fontsource-variable/inter';

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
  const scopeClassName = className ? `${THEME_SCOPE_CLASS} ${className}` : THEME_SCOPE_CLASS;

  return (
    <div className={scopeClassName} data-theme-id={resolvedTheme.id}>
      <style>{tokensToCss(tokens)}</style>
      {customCss ? <style>{customCss}</style> : null}
      {children}
    </div>
  );
}
