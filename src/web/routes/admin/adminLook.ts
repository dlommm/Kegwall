import { useEffect, useState } from 'react';
import type { WallConfig } from '../../../server/core/wallConfig.js';

/**
 * Kegwall V2 admin: one look and feel (owner decision D10). Dark "Cellar" by default, the
 * light "Workshop" counterpart when the device prefers a light scheme. The old per-browser
 * appearance (`kegtron.adminTheme` in localStorage) is simply ignored.
 *
 * The admin pages still read the legacy theme names (`--bg`, `--surface`, `--accent`, …), so
 * the look is a base theme plus overrides fed to the shell's ThemeProvider. `--frame`,
 * `--surface-2`, `--surface-3`, `--accent-ink`, `--foam`, `--shadow-float` and `--info` are
 * admin-only additions.
 */
const DISPLAY = "'Big Shoulders Display Variable', 'Big Shoulders Display', 'Arial Narrow', sans-serif";
const TEXT = "'Atkinson Hyperlegible', system-ui, sans-serif";

export const ADMIN_LOOK_DARK: WallConfig['theme'] = {
  id: 'taproom',
  overrides: {
    // Kegwall 2.1 contrast pass: a warm charcoal page on a darker frame, then three surface
    // steps far enough apart to read (frame → page → panel → raised → selected).
    '--frame': '#0A0908',
    '--bg': '#16130F',
    '--surface': '#201C18',
    '--surface-2': '#2A2520',
    '--surface-3': '#352F29',
    '--text': '#F7F4EE',
    '--text-dim': '#C2BBAF',
    '--text-faint': '#958D81',
    '--accent': '#E0975A',
    '--accent-ink': '#1A0F06',
    '--border': '#352F29',
    '--border-strong': '#57504A',
    '--ok': '#86D49A',
    '--warn': '#F4B740',
    '--danger': '#FF7A66',
    '--info': '#8FB4E0',
    '--foam': '#F3E9D2',
    '--shadow-float': '0 18px 48px rgb(0 0 0 / 0.5), 0 0 0 1px #352F29',
    '--card-radius': '12px',
    '--font-display': DISPLAY,
    '--font-body': TEXT,
  },
};

export const ADMIN_LOOK_LIGHT: WallConfig['theme'] = {
  id: 'cream',
  overrides: {
    '--frame': '#E9E3D7',
    '--bg': '#F5F2EC',
    '--surface': '#FFFFFF',
    '--surface-2': '#EDE8DE',
    '--surface-3': '#E2DACB',
    '--text': '#1C1916',
    '--text-dim': '#57504A',
    '--text-faint': '#706760',
    '--accent': '#A9501F',
    '--accent-ink': '#FFF8F0',
    '--border': '#E2DCD0',
    '--border-strong': '#B9B0A2',
    '--ok': '#2E7D46',
    '--warn': '#8F5C00',
    '--danger': '#B4321E',
    '--info': '#2F5F95',
    '--foam': '#F3E9D2',
    '--shadow-float': '0 12px 32px rgb(60 40 20 / 0.16), 0 0 0 1px #E2DCD0',
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
