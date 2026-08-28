import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { login, needsSetup, sanitizeNextPath } from '../../lib/adminApi';
import { ThemeProvider } from '../../themes/ThemeProvider';

type ErrorKind = 'badCredentials' | 'rateLimited' | 'other' | null;

/**
 * `/admin/login`: username/password -> `POST /api/auth/login`. Before rendering the
 * form, probes `GET /api/auth/needs-setup` — a fresh install has no admin yet, so this
 * bounces straight to `/admin/setup` instead of showing a login form nobody can use.
 * A probe failure (network hiccup) fails safe by falling through to the login form
 * rather than getting stuck on a blank page.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [checkingSetup, setCheckingSetup] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorKind, setErrorKind] = useState<ErrorKind>(null);

  useEffect(() => {
    let cancelled = false;
    needsSetup().then((result) => {
      if (cancelled) return;
      if (result.ok && result.data.needsSetup) {
        navigate('/admin/setup', { replace: true });
        return;
      }
      setCheckingSetup(false);
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrorKind(null);
    const result = await login(username, password);
    setSubmitting(false);
    if (result.ok) {
      // Return-to: adminApi's 401 redirect stashes the interrupted page in `?next=` so a
      // re-login lands the admin back where they were, not on the dashboard. Validated
      // through sanitizeNextPath (same-origin relative paths only — open-redirect guard);
      // anything unsafe or absent falls back to the dashboard.
      navigate(sanitizeNextPath(searchParams.get('next')) ?? '/admin', { replace: true });
      return;
    }
    if (result.status === 429) {
      setErrorKind('rateLimited');
    } else if (result.status === 401) {
      setErrorKind('badCredentials');
    } else {
      setErrorKind('other');
    }
  }

  if (checkingSetup) return null;

  return (
    <ThemeProvider className="admin-auth">
      <main className="admin-auth__page" data-testid="login-page">
        <form className="admin-auth__form" onSubmit={handleSubmit} data-testid="login-form">
          <h1 className="admin-auth__title font-display">Sign in</h1>
          <p className="admin-auth__intro">Sign in to manage beers, taps, and the wall.</p>

          <label className="admin-auth__field">
            <span>Username</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </label>

          <label className="admin-auth__field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {errorKind === 'badCredentials' && (
            <p
              className="admin-auth__notice admin-auth__notice--error"
              role="alert"
              data-testid="login-error-bad-credentials"
            >
              Wrong username or password.
            </p>
          )}
          {errorKind === 'rateLimited' && (
            <p
              className="admin-auth__notice admin-auth__notice--warning"
              role="alert"
              data-testid="login-error-rate-limited"
            >
              Too many attempts. Wait a moment and try again.
            </p>
          )}
          {errorKind === 'other' && (
            <p
              className="admin-auth__notice admin-auth__notice--error"
              role="alert"
              data-testid="login-error-other"
            >
              Something went wrong. Try again.
            </p>
          )}

          <button type="submit" className="admin-auth__submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </main>
    </ThemeProvider>
  );
}
