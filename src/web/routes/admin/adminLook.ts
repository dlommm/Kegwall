import { useEffect, useState } from 'react';
import type { WallConfig } from '../../../server/core/wallConfig.js';

/**
 * Kegwall V2 admin: one look and feel (owner decision D10). Dark "Cellar" by default, the
 * light "Workshop" counterpart when the device prefers a light scheme. The old per-browser
 * appearance (`kegtron.adminTheme` in localStorage) is simply ignored.
 *
 * The admin pages still read the legacy theme names (`--bg`, `--surface`, `--accent`, …), so
 * the look is a base theme plus overrides fed to the shell's ThemeProvider. `--surface-2` and
 * `--info` are admin-only additions.
 */
const DISPLAY = "'Big Shoulders Display Variable', 'Big Shoulders Display', 'Arial Narrow', sans-serif";
const TEXT = "'Atkinson Hyperlegible', system-ui, sans-serif";

export const ADMIN_LOOK_DARK: WallConfig['theme'] = {
  id: 'taproom',
  overrides: {
    '--bg': '#0D0C0B',
    '--surface': '#171513',
    '--surface-2': '#211E1B',
    '--text': '#F7F4EE',
    '--text-dim': '#BDB6AA',
    '--text-faint': '#8C857A',
    '--accent': '#E0975A',
    '--border': '#2A2622',
    '--border-strong': '#4E4840',
    '--ok': '#86D49A',
    '--warn': '#F4B740',
    '--danger': '#FF7A66',
    '--info': '#8FB4E0',
    '--card-radius': '12px',
    '--font-display': DISPLAY,
    '--font-body': TEXT,
  },
};

export const ADMIN_LOOK_LIGHT: WallConfig['theme'] = {
  id: 'cream',
  overrides: {
    '--bg': '#F5F2EC',
    '--surface': '#FFFFFF',
    '--surface-2': '#EDE8DE',
    '--text': '#1C1916',
    '--text-dim': '#57504A',
    '--text-faint': '#7A7168',
    '--accent': '#A9501F',
    '--border': '#E2DCD0',
    '--border-strong': '#B9B0A2',
    '--ok': '#2E7D46',
    '--warn': '#8F5C00',
    '--danger': '#B4321E',
    '--info': '#2F5F95',
    '--card-radius': '12px',
    '--font-display': DISPLAY,
    '--font-body': TEXT,
  },
};

const LIGHT_QUERY = '(prefers-color-scheme: light)';

function prefersLight(): boolean {
  try {
    return window.matchMedia?.(LIGHT_QUERY).matches ?? false;
  } catch {
    return false;
  }
}

/** The admin look for this device, following the system color scheme as it changes. */
export function useAdminLook(): { scheme: 'dark' | 'light'; theme: WallConfig['theme'] } {
  const [light, setLight] = useState(prefersLight);
  useEffect(() => {
    const mql = typeof window.matchMedia === 'function' ? window.matchMedia(LIGHT_QUERY) : null;
    if (!mql) return undefined;
    const onChange = () => setLight(mql.matches);
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, []);
  return light
    ? { scheme: 'light', theme: ADMIN_LOOK_LIGHT }
    : { scheme: 'dark', theme: ADMIN_LOOK_DARK };
}
