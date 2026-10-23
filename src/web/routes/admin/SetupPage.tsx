import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { needsSetup, setup } from '../../lib/adminApi';
import { AuthFrame } from './AuthFrame';
import { WELCOME_STEP_COUNT } from './WelcomePage';

const MIN_PASSWORD_LENGTH = 8;

/**
 * `/admin/setup`: the first-run wizard that creates the taproom's one initial admin
 * account (`POST /api/auth/setup`). Hidden once setup has already happened — the same
 * `GET /api/auth/needs-setup` probe `LoginPage` uses redirects a returning visitor to
 * `/admin/login` instead of letting them re-run this form (the server would 409 anyway,
 * but bouncing away up front is a clearer story than "fill out a form, then get an
 * error").
 */
export function SetupPage() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [claimToken, setClaimToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    needsSetup().then((result) => {
      if (cancelled) return;
      if (result.ok && !result.data.needsSetup) {
        navigate('/admin/login', { replace: true });
        return;
      }
      setChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setServerError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setValidationError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setValidationError('Passwords don’t match.');
      return;
    }
    setValidationError(null);

    setSubmitting(true);
    const result = await setup({
      username, displayName, password,
      claimToken: claimToken.trim() || undefined,
    });
    setSubmitting(false);
    if (result.ok) {
      // Fresh install → straight into the guided first-run wizard (the session cookie
      // from POST /api/auth/setup is already set, so /admin/welcome runs authed).
      navigate('/admin/welcome', { replace: true });
      return;
    }
    setServerError(result.message);
  }

  if (checking) return null;

  return (
    <AuthFrame
      testId="setup-page"
      step={{ current: 1, total: WELCOME_STEP_COUNT + 1 }}
      title="Create the owner account."
      intro="A one-time setup. You sign in with this account from now on."
      aside={(
        <>
          <h2>Next</h2>
          <ol>
            <li>Name the taproom.</li>
            <li>Connect your Kegtron monitors.</li>
            <li>Home Assistant, if you use it.</li>
            <li>Put the wall on a screen.</li>
            <li>Choose how updates install.</li>
          </ol>
        </>
      )}
    >
        <form className="admin-auth__form" onSubmit={handleSubmit} data-testid="setup-form">

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
            <span>Display name</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="name"
              required
            />
          </label>

          <label className="admin-auth__field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
            />
          </label>

          <label className="admin-auth__field">
            <span>Confirm password</span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </label>

          <label className="admin-auth__field">
            <span>Setup token</span>
            <input
              type="text"
              value={claimToken}
              onChange={(e) => setClaimToken(e.target.value)}
              autoComplete="off"
              data-testid="setup-claim-token"
              placeholder="Printed in the server logs on first start"
            />
            <small className="admin-auth__hint">
              Find it in the server console / <code>docker logs</code> — shown once, when no
              admin exists yet.
            </small>
          </label>

          {validationError && (
            <p
              className="admin-auth__notice admin-auth__notice--error"
              role="alert"
              data-testid="setup-validation-error"
            >
              {validationError}
            </p>
          )}
          {serverError && (
            <p
              className="admin-auth__notice admin-auth__notice--error"
              role="alert"
              data-testid="setup-server-error"
            >
              {serverError}
            </p>
          )}

          <button type="submit" className="admin-auth__submit" disabled={submitting}>
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>
    </AuthFrame>
  );
}
