import { useState, type FormEvent } from 'react';
import type { Role, User } from '../../../../server/db/users.js';
import { createLoginUser, createDrinkerProfile, updateUser } from '../../../lib/adminApi';
import { Button } from '../ui';

// The accounts forms (Task 8), split out of UsersPage in Kegwall V2 M8. Each renders inside
// the People page's drawer, which carries the title.

export const ROLE_OPTIONS: readonly Role[] = ['admin', 'editor', 'viewer'];
export const DEFAULT_AVATAR_COLOR = '#c9a227'; // matches the taproom theme's brass accent
export const ROLE_LABELS: Record<Role, string> = { admin: 'Admin', editor: 'Editor', viewer: 'Viewer' };
/** What each role may do, said plainly (prototypes/admin-people.html). */
export const ROLE_CAN: Record<Role, string> = {
  admin: 'Everything, including costs and settings',
  editor: 'Run taps, beers and walls. No costs or settings',
  viewer: 'Look, but change nothing',
};

function userLabel(user: User): string {
  return user.displayName;
}

/** Create-login-user form (Task 8). */
export function LoginUserForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setServerError(null);
    if (!username.trim() || !displayName.trim()) {
      setValidationError('Username and display name are required.');
      return;
    }
    if (password.length < 8) {
      setValidationError('Password must be at least 8 characters.');
      return;
    }
    setValidationError(null);
    setSubmitting(true);
    const result = await createLoginUser({
      username: username.trim(), displayName: displayName.trim(), password, role,
    });
    setSubmitting(false);
    if (!result.ok) {
      setServerError(result.message);
      return;
    }
    onSaved();
  }

  return (
    <form
      className="adm-form"
      data-testid="users-login-form"
      aria-label="Add login user"
      onSubmit={handleSubmit}
    >
      <p className="adm-sub" style={{ margin: 0 }}>Has a username and password, and can sign in to this admin area.</p>
      <div className="adm-grid-2">
        <label className="admin-field">
          <span>Username</span>
          <input
            type="text"
            data-testid="users-login-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
        </label>
        <label className="admin-field">
          <span>Display name</span>
          <input
            type="text"
            data-testid="users-login-displayname"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>
        <label className="admin-field">
          <span>Password</span>
          <input
            type="password"
            data-testid="users-login-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
          />
        </label>
        <label className="admin-field">
          <span>Role</span>
          <select
            data-testid="users-login-role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </label>
      </div>
      {validationError && (
        <p className="adm-danger-text" role="alert" data-testid="users-login-validation-error">
          {validationError}
        </p>
      )}
      {serverError && (
        <p className="adm-danger-text" role="alert" data-testid="users-login-server-error">
          {serverError}
        </p>
      )}
      <div className="adm-form__actions">
        <Button type="submit" variant="primary" disabled={submitting} data-testid="users-login-submit">
          {submitting ? 'Adding…' : 'Add login user'}
        </Button>
        <Button variant="quiet" disabled={submitting} onClick={onCancel} data-testid="users-login-cancel">
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Create-drinker-only-profile form (Task 8): no username/password — a leaderboard/
 * claim-a-pour identity with no admin access. */
export function DrinkerProfileForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const [displayName, setDisplayName] = useState('');
  const [avatarColor, setAvatarColor] = useState(DEFAULT_AVATAR_COLOR);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setServerError(null);
    if (!displayName.trim()) {
      setValidationError('Display name is required.');
      return;
    }
    setValidationError(null);
    setSubmitting(true);
    const result = await createDrinkerProfile({ displayName: displayName.trim(), avatarColor });
    setSubmitting(false);
    if (!result.ok) {
      setServerError(result.message);
      return;
    }
    onSaved();
  }

  return (
    <form
      className="adm-form"
      data-testid="users-drinker-form"
      aria-label="Add drinker profile"
      onSubmit={handleSubmit}
    >
      <p className="adm-sub" style={{ margin: 0 }}>No login — just a name for claiming pours and the leaderboard.</p>
      <div className="adm-grid-2">
        <label className="admin-field">
          <span>Display name</span>
          <input
            type="text"
            data-testid="users-drinker-displayname"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoFocus
          />
        </label>
        <label className="admin-field">
          <span>Avatar color</span>
          <input
            type="color"
            data-testid="users-drinker-avatarcolor"
            value={avatarColor}
            onChange={(e) => setAvatarColor(e.target.value)}
          />
        </label>
      </div>
      {validationError && (
        <p className="adm-danger-text" role="alert" data-testid="users-drinker-validation-error">
          {validationError}
        </p>
      )}
      {serverError && (
        <p className="adm-danger-text" role="alert" data-testid="users-drinker-server-error">
          {serverError}
        </p>
      )}
      <div className="adm-form__actions">
        <Button type="submit" variant="primary" disabled={submitting} data-testid="users-drinker-submit">
          {submitting ? 'Adding…' : 'Add drinker profile'}
        </Button>
        <Button variant="quiet" disabled={submitting} onClick={onCancel} data-testid="users-drinker-cancel">
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Edit form (Task 8): display name + avatar color for every user; role + optional
 * password only for a login user (a drinker-only profile has neither — see UsersPage's
 * doc comment). Matches the plan's exact edit-field list. */
export function EditUserForm({ user, onSaved, onCancel }: {
  user: User; onSaved: () => void; onCancel: () => void;
}) {
  const isLogin = user.username != null;
  const [displayName, setDisplayName] = useState(user.displayName);
  const [role, setRole] = useState<Role>(user.role ?? 'viewer');
  const [password, setPassword] = useState('');
  const [avatarColor, setAvatarColor] = useState(user.avatarColor ?? DEFAULT_AVATAR_COLOR);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setServerError(null);
    if (!displayName.trim()) {
      setValidationError('Display name is required.');
      return;
    }
    if (isLogin && password && password.length < 8) {
      setValidationError('Password must be at least 8 characters, or left blank to keep the current one.');
      return;
    }
    setValidationError(null);
    setSubmitting(true);
    const result = await updateUser(user.id, {
      displayName: displayName.trim(),
      avatarColor,
      ...(isLogin ? { role } : {}),
      ...(isLogin && password ? { password } : {}),
    });
    setSubmitting(false);
    if (!result.ok) {
      setServerError(result.message);
      return;
    }
    onSaved();
  }

  return (
    <form
      className="adm-form"
      data-testid="users-edit-form"
      aria-label={`Edit ${userLabel(user)}`}
      onSubmit={handleSubmit}
    >
      <div className="adm-grid-2">
        <label className="admin-field">
          <span>Display name</span>
          <input
            type="text"
            data-testid="users-edit-displayname"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoFocus
          />
        </label>
        {isLogin && (
          <label className="admin-field">
            <span>Role</span>
            <select
              data-testid="users-edit-role"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </label>
        )}
        {isLogin && (
          <label className="admin-field">
            <span>New password</span>
            <input
              type="password"
              data-testid="users-edit-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave blank to keep the current password"
            />
          </label>
        )}
        <label className="admin-field">
          <span>Avatar color</span>
          <input
            type="color"
            data-testid="users-edit-avatarcolor"
            value={avatarColor}
            onChange={(e) => setAvatarColor(e.target.value)}
          />
        </label>
      </div>
      {validationError && (
        <p className="adm-danger-text" role="alert" data-testid="users-edit-validation-error">
          {validationError}
        </p>
      )}
      {serverError && (
        <p className="adm-danger-text" role="alert" data-testid="users-edit-server-error">
          {serverError}
        </p>
      )}
      <div className="adm-form__actions">
        <Button type="submit" variant="primary" disabled={submitting} data-testid="users-edit-submit">
          {submitting ? 'Saving…' : 'Save changes'}
        </Button>
        <Button variant="quiet" disabled={submitting} onClick={onCancel} data-testid="users-edit-cancel">
          Cancel
        </Button>
      </div>
    </form>
  );
}

