import { useEffect } from 'react';

/**
 * Scale-to-fit for TV kiosks (4K/1080p/720p): the wall's looks are designed against a
 * ~1080p canvas, so on a 4K panel (CSS viewport 2160px tall at the TV's typical
 * devicePixelRatio of 1) everything renders half-size. Setting document zoom to
 * viewportHeight / 1080 makes every resolution render identically proportioned —
 * 720p slightly down, 1080p at 1, 4K doubled.
 *
 * CSS `zoom` (not a transform): it participates in layout, so nothing overflows or
 * mis-hit-tests, and every engine the kiosk stack uses supports it (the kiosk IS
 * chromium; Firefox 126+ and Safari have it too). Clamped so a phone accidentally
 * opening /wall doesn't get microscopic text, and skipped entirely at ~1080p where
 * it would only add rounding blur.
 */
const DESIGN_HEIGHT = 1080;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;

export function useKioskScale(enabled = true): void {
  useEffect(() => {
    if (!enabled) return undefined;
    const apply = () => {
      const raw = window.innerHeight / DESIGN_HEIGHT;
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, raw));
      // Within ~10% of the design height, native rendering beats a fractional zoom.
      (document.documentElement.style as CSSStyleDeclaration & { zoom?: string }).zoom = Math.abs(zoom - 1) < 0.1 ? '' : String(zoom);
    };
    apply();
    window.addEventListener('resize', apply);
    return () => {
      window.removeEventListener('resize', apply);
      (document.documentElement.style as CSSStyleDeclaration & { zoom?: string }).zoom = '';
    };
  }, [enabled]);
}
