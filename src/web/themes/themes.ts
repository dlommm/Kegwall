/**
 * Built-in wall/menu themes. Each theme is a flat CSS-custom-property token
 * set applied by `ThemeProvider` (see ./ThemeProvider.tsx) as inline CSS on a
 * scoping element; every visual surface reads colors/fonts through these
 * tokens (`var(--bg)`, `var(--accent)`, ...) rather than hard-coded values.
 *
 * The catalog has two generations:
 *  - The redesign set (Pour Wall overhaul handoff, option 7a): Midnight Slate
 *    (flagship/default), Cream, Cellar Teal, Taproom Green, Amber Glow and
 *    Arcade — typeset in Barlow Condensed (display) / Barlow (body).
 *  - The four legacy themes (taproom/chalkboard/bright/mono) kept so existing
 *    walls' stored `theme.id`s keep rendering exactly as before — typeset in
 *    Oswald / Inter as they always were.
 *
 * A theme is a color + shape skin; the wall LOOK (layout template) is a
 * separate config axis (`wallConfig.look`). Every theme must define the full
 * token set below — looks and glyphs read all of them.
 */

const FONT_DISPLAY = "'Barlow Condensed', sans-serif";
const FONT_BODY = "'Barlow', ui-sans-serif, system-ui, sans-serif";
const LEGACY_FONT_DISPLAY = "'Oswald Variable', 'Oswald', sans-serif";
const LEGACY_FONT_BODY = "'Inter Variable', 'Inter', ui-sans-serif, system-ui, sans-serif";

/** Status colors (keg level: ok > 35% > warn > 15% > danger) shared by every
 * dark theme; light themes carry slightly deeper variants for contrast on
 * pale surfaces (values from the design doc's light "Gallery" option). */
const STATUS_DARK = { '--ok': '#57B45F', '--warn': '#E5B84A', '--danger': '#E05B4B' };
const STATUS_LIGHT = { '--ok': '#4A9156', '--warn': '#C08A2E', '--danger': '#C54836' };

export interface Theme {
  id: string;
  name: string;
  /** Whether the ground is dark or light. Looks pick ink and glare treatments from it, and
   * the Wall Editor groups swatches by it (Kegwall V2). */
  mode: 'dark' | 'light';
  tokens: Record<string, string>;
}

/** The four colors a theme swatch shows in the Wall Editor, read from the theme's own
 * tokens so a swatch can never drift from what the wall renders. */
export interface ThemePreview {
  ground: string;
  surface: string;
  ink: string;
  accent: string;
}

export function themePreview(theme: Theme): ThemePreview {
  const t = theme.tokens;
  return { ground: t['--bg']!, surface: t['--surface']!, ink: t['--text']!, accent: t['--accent']! };
}

/** Tabular alignment for ABV/IBU/% comes from `font-variant-numeric:
 * tabular-nums` applied where this token is used — Barlow/Inter both ship
 * tabular figures, so no separate monospace family is needed. */
function fonts(display: string, body: string): Record<string, string> {
  return {
    '--font-display': display,
    '--font-body': body,
    '--font-mono-numeric': body,
  };
}

// --- Redesign themes (handoff option 7a) ------------------------------------

const midnightSlateTheme: Theme = {
  id: 'midnight-slate',
  name: 'Midnight Slate',
  mode: 'dark',
  tokens: {
    '--bg': '#0F1216',
    '--surface': 'rgba(255,255,255,0.04)',
    '--text': '#E9EDF1',
    '--text-dim': '#93A0AC',
    '--text-faint': '#6E7B87',
    '--accent': '#D08C4C',
    '--border': 'rgba(255,255,255,0.08)',
    '--border-strong': 'rgba(255,255,255,0.12)',
    '--card-radius': '16px',
    ...STATUS_DARK,
    ...fonts(FONT_DISPLAY, FONT_BODY),
  },
};

const creamTheme: Theme = {
  id: 'cream',
  name: 'Cream',
  mode: 'light',
  tokens: {
    '--bg': '#F4F1EB',
    '--surface': '#FFFFFF',
    '--text': '#26211A',
    '--text-dim': '#877E71',
    '--text-faint': '#A69C8D',
    '--accent': '#B4622D',
    '--border': '#E7E1D5',
    '--border-strong': 'rgba(38,33,26,0.2)',
    '--card-radius': '18px',
    ...STATUS_LIGHT,
    ...fonts(FONT_DISPLAY, FONT_BODY),
  },
};

const cellarTealTheme: Theme = {
  id: 'cellar-teal',
  name: 'Cellar Teal',
  mode: 'dark',
  tokens: {
    '--bg': '#0A0D12',
    '--surface': 'rgba(255,255,255,0.03)',
    '--text': '#EAF2EF',
    '--text-dim': '#7E948C',
    '--text-faint': '#5D6F68',
    '--accent': '#5FD9BC',
    '--border': 'rgba(255,255,255,0.06)',
    '--border-strong': 'rgba(255,255,255,0.12)',
    '--card-radius': '18px',
    ...STATUS_DARK,
    ...fonts(FONT_DISPLAY, FONT_BODY),
  },
};

const taproomGreenTheme: Theme = {
  id: 'taproom-green',
  name: 'Taproom Green',
  mode: 'dark',
  tokens: {
    '--bg': '#12211B',
    '--surface': '#1A2E25',
    '--text': '#EDEFE7',
    '--text-dim': '#93A79B',
    '--text-faint': '#6F8177',
    '--accent': '#E7B93F',
    '--border': 'rgba(237,239,231,0.1)',
    '--border-strong': 'rgba(237,239,231,0.18)',
    '--card-radius': '14px',
    ...STATUS_DARK,
    ...fonts(FONT_DISPLAY, FONT_BODY),
  },
};

const amberGlowTheme: Theme = {
  id: 'amber-glow',
  name: 'Amber Glow',
  mode: 'dark',
  tokens: {
    '--bg': '#1A120C',
    '--surface': '#241A11',
    '--text': '#F3EAD9',
    '--text-dim': '#A79883',
    '--text-faint': '#7D7261',
    '--accent': '#E0A83D',
    '--border': 'rgba(243,234,217,0.1)',
    '--border-strong': 'rgba(243,234,217,0.18)',
    '--card-radius': '16px',
    ...STATUS_DARK,
    ...fonts(FONT_DISPLAY, FONT_BODY),
  },
};

const arcadeTheme: Theme = {
  id: 'arcade',
  name: 'Arcade',
  mode: 'dark',
  tokens: {
    '--bg': '#0D0B14',
    '--surface': 'rgba(180,140,255,0.06)',
    '--text': '#EDEAF6',
    '--text-dim': '#9A93B0',
    '--text-faint': '#6F6987',
    '--accent': '#B48CFF',
    '--border': 'rgba(180,140,255,0.18)',
    '--border-strong': 'rgba(180,140,255,0.32)',
    '--card-radius': '14px',
    ...STATUS_DARK,
    // Arcade's secondary neon (teal) rides along as an extra token for looks
    // that want a two-tone treatment; unused elsewhere.
    '--accent-2': '#5FD9BC',
    ...fonts(FONT_DISPLAY, FONT_BODY),
  },
};

// --- Legacy themes (pre-overhaul catalog, kept for stored configs) ----------

const taproomTheme: Theme = {
  id: 'taproom',
  name: 'Taproom (legacy)',
  mode: 'dark',
  tokens: {
    '--bg': '#19140F',
    '--surface': '#241C15',
    '--text': '#F3EAD9',
    '--text-dim': '#A79883',
    '--text-faint': '#7D7261',
    '--accent': '#C9972B',
    '--border': 'rgba(243,234,217,0.12)',
    '--border-strong': 'rgba(243,234,217,0.2)',
    '--card-radius': '0.75rem',
    ...STATUS_DARK,
    ...fonts(LEGACY_FONT_DISPLAY, LEGACY_FONT_BODY),
  },
};

const chalkboardTheme: Theme = {
  id: 'chalkboard',
  name: 'Chalkboard (legacy)',
  mode: 'dark',
  tokens: {
    '--bg': '#12211B',
    '--surface': '#1A2E25',
    '--text': '#EDEFE7',
    '--text-dim': '#93A79B',
    '--text-faint': '#6F8177',
    '--accent': '#E7B93F',
    '--border': 'rgba(237,239,231,0.12)',
    '--border-strong': 'rgba(237,239,231,0.2)',
    '--card-radius': '0.5rem',
    ...STATUS_DARK,
    ...fonts(LEGACY_FONT_DISPLAY, LEGACY_FONT_BODY),
  },
};

const brightTheme: Theme = {
  id: 'bright',
  name: 'Bright (legacy)',
  mode: 'light',
  tokens: {
    '--bg': '#F7F4EE',
    '--surface': '#FFFFFF',
    '--text': '#1E1A15',
    '--text-dim': '#6E6558',
    '--text-faint': '#94897A',
    '--accent': '#A8672B',
    '--border': 'rgba(30,26,21,0.12)',
    '--border-strong': 'rgba(30,26,21,0.2)',
    '--card-radius': '1rem',
    ...STATUS_LIGHT,
    ...fonts(LEGACY_FONT_DISPLAY, LEGACY_FONT_BODY),
  },
};

const monoTheme: Theme = {
  id: 'mono',
  name: 'Mono (legacy)',
  mode: 'dark',
  tokens: {
    '--bg': '#0A0A0A',
    '--surface': '#161616',
    '--text': '#FFFFFF',
    '--text-dim': '#8C8C8C',
    '--text-faint': '#5E5E5E',
    '--accent': '#E0A83D',
    '--border': 'rgba(255,255,255,0.12)',
    '--border-strong': 'rgba(255,255,255,0.2)',
    '--card-radius': '0.125rem',
    ...STATUS_DARK,
    ...fonts(LEGACY_FONT_DISPLAY, LEGACY_FONT_BODY),
  },
};

/** All built-in themes, redesign set first (picker order), legacy set after. */
export const THEMES: readonly Theme[] = [
  midnightSlateTheme, creamTheme, cellarTealTheme, taproomGreenTheme, amberGlowTheme, arcadeTheme,
  taproomTheme, chalkboardTheme, brightTheme, monoTheme,
];

export const DEFAULT_THEME_ID = 'midnight-slate';

/** Look up a built-in theme by id; unknown/missing ids fall back to the default. */
export function getTheme(id: string | undefined): Theme {
  const found = id ? THEMES.find((t) => t.id === id) : undefined;
  return found ?? midnightSlateTheme;
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
 * fall back to the default theme (via `getTheme`), then any well-formed
 * overrides are applied on top. Overrides that aren't a `--custom-property`
 * key, or whose value could break out of a CSS declaration, are dropped rather
 * than applied — wall config is admin-authored but rendered on a public page,
 * so this is a cheap safety net against CSS injection via the overrides map.
 * (`customCss` is intentionally raw, trusted CSS by design — see ThemeProvider.)
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
