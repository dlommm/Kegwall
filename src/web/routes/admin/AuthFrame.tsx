import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { ThemeProvider } from '../../themes/ThemeProvider';
import { getMenu } from '../../lib/api';
import { beerColorFor } from '../../wall/wallModel';
import { useAdminLook } from './adminLook';
import './auth.css';

export interface AuthFrameProps {
  /** The page's sentence ("Sign in to run the taproom."). A multi-step page may draw its own
   * per-step heading instead. */
  title?: ReactNode;
  /** One line under the title. */
  intro?: ReactNode;
  /** "First-run setup · step 2 of 7", drawn as a bar of steps. */
  step?: { current: number; total: number };
  /** The quiet panel on the right (hidden on phones). */
  aside?: ReactNode;
  testId: string;
  children: ReactNode;
}

/**
 * Sign-in, first-run setup and the welcome wizard (Kegwall V2 M10, prototypes/admin-signin.html):
 * the admin look (dark, or light by system preference) without the top bar, since nobody is
 * signed in yet. The form sits on the left under a sentence; a quiet panel on the right says
 * what happens next.
 */
/** Sample levels for a fresh install's empty columns. */
const SAMPLE = [0.82, 0.5, 0.94, 0.3, 0.66, 0.18];

/**
 * The taps as tall columns of beer at their keg levels, over the sign-in panel (Kegwall 2.1
 * "g-login"): the wall shown, not described. A fresh install (or a menu that needs a display
 * token) shows quiet sample columns and says the taps will appear.
 */
function AuthTaps() {
  const [cols, setCols] = useState<{ color: string; level: number }[] | null>(null);
  useEffect(() => {
    let alive = true;
    void getMenu().then((r) => {
      if (!alive) return;
      const on = r.ok ? r.data.taps.filter((t) => t.beer && t.keg?.status === 'on_tap' && !t.hidden) : [];
      setCols(on.slice(0, 12).map((t) => ({ color: beerColorFor(t.beer!.srm), level: Math.max(0.04, (t.keg!.levelPct ?? 0) / 100) })));
    }).catch(() => { if (alive) setCols([]); });
    return () => { alive = false; };
  }, []);
  const sample = cols !== null && cols.length === 0;
  const shown = sample ? SAMPLE.map((level) => ({ color: '', level })) : cols ?? [];
  return (
    <div className="adm-auth__taps" data-sample={sample || undefined} aria-hidden="true">
      <div className="adm-auth__cols">
        {shown.map((c, i) => (
          // eslint-disable-next-line react/no-array-index-key -- columns have no identity
          <span key={i} style={{ '--level': c.level, '--beer': c.color || undefined } as CSSProperties}><i /></span>
        ))}
      </div>
      {sample && <p className="adm-auth__taps-note">Your taps will show up here.</p>}
    </div>
  );
}

export function AuthFrame({
  title, intro, step, aside, testId, children,
}: AuthFrameProps) {
  const look = useAdminLook();
  return (
    <ThemeProvider theme={look.theme} className="admin-auth">
      <main className="adm-auth" data-admin-scheme={look.scheme} data-testid={testId}>
        <section className="adm-auth__main">
          <p className="adm-auth__brand">Kegwall</p>
          {step && (
            <div className="adm-auth__steps" role="img" aria-label={`Step ${step.current} of ${step.total}`}>
              <p className="adm-auth__step-label">{`First-run setup · step ${step.current} of ${step.total}`}</p>
              <div className="adm-auth__bar" aria-hidden="true">
                {Array.from({ length: step.total }, (_, i) => (
                  // eslint-disable-next-line react/no-array-index-key -- positional steps
                  <span key={i} className={i < step.current ? 'is-on' : undefined} />
                ))}
              </div>
            </div>
          )}
          {title && <h1 className="adm-auth__title">{title}</h1>}
          {intro && <p className="adm-auth__intro">{intro}</p>}
          {children}
        </section>
        {aside && (
          <aside className="adm-auth__aside">
            <AuthTaps />
            {aside}
          </aside>
        )}
      </main>
    </ThemeProvider>
  );
}
