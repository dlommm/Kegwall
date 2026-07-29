import type { WallConfig } from '../../server/core/wallConfig.js';

/**
 * Admin appearance (design turns 5 + 8: "3 admin looks, selectable like wall
 * themes"): each look is a base wall theme + admin-specific token overrides,
 * fed straight into the admin shell's ThemeProvider. Per-browser (localStorage)
 * — appearance is a personal working preference, not taproom config.
 *
 *  - Midnight Slate (5a, default): dark #101418 content / #0C0F13 sidebar /
 *    #161B21 cards, copper accent.
 *  - Workshop (8h): light #F5F2EC, white cards, terracotta accent.
 *  - Console (8i): mono — near-black, terminal green, IBM Plex Mono.
 */

export type AdminThemeId = 'midnight' | 'workshop' | 'console';

export interface AdminTheme {
  id: AdminThemeId;
  name: string;
  theme: WallConfig['theme'];
}

const MONO_FONT = "'IBM Plex Mono', ui-monospace, Menlo, monospace";

export const ADMIN_THEMES: readonly AdminTheme[] = [
  {
    id: 'midnight',
    name: 'Midnight Slate',
    theme: {
      id: 'midnight-slate',
      overrides: {
        '--bg': '#101418',
        '--admin-sidebar': '#0C0F13',
        '--surface': '#161B21',
        '--border': 'rgba(255,255,255,0.06)',
        '--card-radius': '14px',
      },
    },
  },
  {
    id: 'workshop',
    name: 'Workshop',
    theme: {
      id: 'cream',
      overrides: {
        '--bg': '#F5F2EC',
        '--admin-sidebar': '#EDE8DE',
        '--surface': '#FFFFFF',
        '--accent': '#C25E36',
        '--border': 'rgba(38,33,26,0.1)',
        '--card-radius': '14px',
      },
    },
  },
  {
    id: 'console',
    name: 'Console',
    theme: {
      id: 'mono',
      overrides: {
        '--bg': '#0A0A0A',
        '--admin-sidebar': '#050505',
        '--surface': '#101010',
        '--text': '#D7E8DC',
        '--text-dim': '#5E8A6C',
        '--text-faint': '#3D5C48',
        '--accent': '#4AF07A',
        '--border': 'rgba(74,240,122,0.14)',
        '--border-strong': 'rgba(74,240,122,0.3)',
        '--card-radius': '4px',
        '--font-display': MONO_FONT,
        '--font-body': MONO_FONT,
        '--font-mono-numeric': MONO_FONT,
      },
    },
  },
];

const STORAGE_KEY = 'kegtron.adminTheme';
export const DEFAULT_ADMIN_THEME_ID: AdminThemeId = 'midnight';

export function getAdminTheme(id: string | null | undefined): AdminTheme {
  return ADMIN_THEMES.find((t) => t.id === id) ?? ADMIN_THEMES[0]!;
}

export function loadAdminThemeId(): AdminThemeId {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return getAdminTheme(raw).id;
  } catch {
    return DEFAULT_ADMIN_THEME_ID;
  }
}

export function saveAdminThemeId(id: AdminThemeId): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Private-mode/quota failures just mean the preference won't stick.
  }
}
