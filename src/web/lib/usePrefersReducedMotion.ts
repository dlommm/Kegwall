import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function readPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(QUERY).matches;
}

/** Pre-`addEventListener` MediaQueryList API (Safari < 14, and some test mocks). */
interface LegacyMediaQueryList {
  addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
  removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
}

/**
 * Tracks the user's `prefers-reduced-motion` preference so components can
 * disable the pour ripple/glow animations per the binding design direction
 * ("prefers-reduced-motion respected everywhere ... pour animation becomes
 * simple level change"). Feature-detects `matchMedia` (absent in some
 * test/SSR environments) and defaults to "no preference" (motion allowed)
 * when it's unavailable, so consumers degrade to their normal animated
 * behavior instead of crashing.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(readPrefersReducedMotion);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;

    const mql = window.matchMedia(QUERY);
    setReduced(mql.matches);

    const handleChange = (event: MediaQueryListEvent) => setReduced(event.matches);

    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handleChange);
      return () => mql.removeEventListener('change', handleChange);
    }

    const legacy = mql as unknown as LegacyMediaQueryList;
    if (typeof legacy.addListener === 'function') {
      legacy.addListener(handleChange);
      return () => legacy.removeListener?.(handleChange);
    }

    return undefined;
  }, []);

  return reduced;
}
