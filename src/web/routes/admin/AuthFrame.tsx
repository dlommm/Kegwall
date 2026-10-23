import type { ReactNode } from 'react';
import { ThemeProvider } from '../../themes/ThemeProvider';
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
        {aside && <aside className="adm-auth__aside">{aside}</aside>}
      </main>
    </ThemeProvider>
  );
}
