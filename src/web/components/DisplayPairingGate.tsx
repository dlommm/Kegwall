import { useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { getMenu } from '../lib/api';

/**
 * Wraps a display route (wall / menu / board / tablet). Probes a gated endpoint once; if the
 * server answers 401 — display-token enforcement is ON and this screen isn't paired — it
 * redirects to `/display` to pair (which stores the token and returns here). Otherwise it's
 * transparent: with enforcement OFF (the default) the probe is a plain 200 and the page
 * renders unchanged; a paired screen's probe carries its stored token and also passes. The
 * page renders immediately either way — the probe only ever *redirects*, never blocks — so
 * there's no blank flash on the common path.
 */
export function DisplayPairingGate({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  useEffect(() => {
    let cancelled = false;
    getMenu().then((r) => {
      if (!cancelled && !r.ok && r.status === 401) navigate('/display', { replace: true });
    });
    return () => { cancelled = true; };
  }, [navigate]);
  return <>{children}</>;
}
