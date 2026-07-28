/**
 * Built-in wall/menu themes. Each theme is a flat CSS-custom-property token
 * set applied by `ThemeProvider` (see ./ThemeProvider.tsx) as inline CSS on a
 * scoping element; every visual surface reads colors/fonts through these
 * tokens (`var(--bg)`, `var(--accent)`, ...) rather than hard-coded values.
 *
 * Typography is shared across all four themes (self-hosted via Fontsource —
 * see ThemeProvider.tsx for the font imports and the task report for why
 * Oswald Variable / Inter Variable were picked): a theme is a color + shape
 * skin, not a different typographic identity.
 */

const FONT_DISPLAY = "'Oswald Variable', 'Oswald', sans-serif";
const FONT_BODY = "'Inter Variable', 'Inter', ui-sans-serif, system-ui, sans-serif";
// Tabular alignment for ABV/IBU/% comes from `font-variant-numeric: tabular-nums`
// applied where this token is used (Inter's tabular figures are designed for
// exactly this) — not a separate monospace family, to keep the self-hosted
// font footprint to the two faces named in the design direction.
const FONT_MONO_NUMERIC = FONT_BODY;

export interface Theme {
  id: string;
  name: string;
  tokens: Record<string, string>;
}

const taproomTheme: Theme = {
  id: 'taproom',
  name: 'Taproom',
  tokens: {
    '--bg': '#19140F',
    '--surface': '#241C15',
    '--text': '#F3EAD9',
    '--text-dim': '#A79883',
    '--accent': '#C9972B',
    '--card-radius': '0.75rem',
    '--font-display': FONT_DISPLAY,
    '--font-body': FONT_BODY,
    '--font-mono-numeric': FONT_MONO_NUMERIC,
  },
};

const chalkboardTheme: Theme = {
  id: 'chalkboard',
  name: 'Chalkboard',
  tokens: {
    '--bg': '#12211B',
    '--surface': '#1A2E25',
    '--text': '#EDEFE7',
    '--text-dim': '#93A79B',
    '--accent': '#E7B93F',
    '--card-radius': '0.5rem',
    '--font-display': FONT_DISPLAY,
    '--font-body': FONT_BODY,
    '--font-mono-numeric': FONT_MONO_NUMERIC,
  },
};

const brightTheme: Theme = {
  id: 'bright',
  name: 'Bright',
  tokens: {
    '--bg': '#F7F4EE',
    '--surface': '#FFFFFF',
    '--text': '#1E1A15',
    '--text-dim': '#6E6558',
    '--accent': '#A8672B',
    '--card-radius': '1rem',
    '--font-display': FONT_DISPLAY,
    '--font-body': FONT_BODY,
    '--font-mono-numeric': FONT_MONO_NUMERIC,
  },
};

const monoTheme: Theme = {
  id: 'mono',
  name: 'Mono',
  tokens: {
    '--bg': '#0A0A0A',
    '--surface': '#161616',
    '--text': '#FFFFFF',
    '--text-dim': '#8C8C8C',
    '--accent': '#E0A83D',
    '--card-radius': '0.125rem',
    '--font-display': FONT_DISPLAY,
    '--font-body': FONT_BODY,
    '--font-mono-numeric': FONT_MONO_NUMERIC,
  },
};

/** The four built-in themes, in the order they should appear in any theme picker UI. */
export const THEMES: readonly Theme[] = [taproomTheme, chalkboardTheme, brightTheme, monoTheme];

export const DEFAULT_THEME_ID = 'taproom';

/** Look up a built-in theme by id; unknown/missing ids fall back to `taproom`. */
export function getTheme(id: string | undefined): Theme {
  const found = id ? THEMES.find((t) => t.id === id) : undefined;
  return found ?? taproomTheme;
}

// Custom-property name: "--" followed by letters, digits and hyphens only.
const SAFE_TOKEN_KEY = /^--[a-zA-Z0-9-]+$/;
// A single CSS declaration value must not be able to close the declaration or
// the enclosing rule — reject anything that could break out of
// `--key: <value>;` when interpolated into a generated stylesheet.
const UNSAFE_VALUE_CHARS = /[;{}<>]/;

function isSafeOverride(key: string, value: string): boolean {
  return SAFE_TOKEN_KEY.test(key) && !UNSAFE_VALUE_CHARS.test(value);
}

/**
 * Resolve the final token set for a theme id + optional overrides: unknown ids
 * fall back to `taproom` (via `getTheme`), then any well-formed overrides are
 * applied on top. Overrides that aren't a `--custom-property` key, or whose
 * value could break out of a CSS declaration, are dropped rather than applied
 * — wall config is admin-authored but rendered on a public page, so this is a
 * cheap safety net against CSS injection via the overrides map. (`customCss`
 * is intentionally raw, trusted CSS by design — see ThemeProvider.)
 */
export function resolveThemeTokens(
  id: string | undefined,
  overrides?: Record<string, string>,
): Record<string, string> {
  const theme = getTheme(id);
  if (!overrides) return { ...theme.tokens };

  const resolved = { ...theme.tokens };
  for (const [key, value] of Object.entries(overrides)) {
    if (isSafeOverride(key, value)) {
      resolved[key] = value;
    }
  }
  return resolved;
}
