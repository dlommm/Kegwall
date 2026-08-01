import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Role, User } from '../../../server/db/users.js';
import {
  listUsers, createLoginUser, createDrinkerProfile, updateUser, deleteUser, getFaceCounts,
} from '../../lib/adminApi';
// Task 9 (Plan B): "Delete face data" reuses the public DELETE (works while face sign-in
// is disabled — see routes/public.ts's doc comment on the route) rather than a new
// admin-only route, same "public route, admin UI caller" precedent already used for
// deleteFaces on the tablet's own armed-screen removal action (TabletPage.tsx).
import { deleteFaces } from '../../lib/api';

type ListStatus = 'loading' | 'loaded' | 'error';

type FormState =
  | { mode: 'choose' }
  | { mode: 'create-login' }
  | { mode: 'create-drinker' }
  | { mode: 'edit'; user: User };

interface DeleteState { user: User; error: string | null }

const ROLE_OPTIONS: readonly Role[] = ['admin', 'editor', 'viewer'];
const DEFAULT_AVATAR_COLOR = '#c9a227'; // matches the taproom theme's brass accent

const ROLE_LABELS: Record<Role, string> = { admin: 'Admin', editor: 'Editor', viewer: 'Viewer' };

function userLabel(user: User): string {
  return user.displayName;
}

/** Create-login-user form (Task 8). */
function LoginUserForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
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
      className="user-form"
      data-testid="users-login-form"
      aria-label="Add login user"
      onSubmit={handleSubmit}
    >
      <h2 className="user-form__title font-display">Add login user</h2>
      <p className="admin-page-quiet">Has a username and password, and can sign in to this admin area.</p>
      <div className="user-form__grid">
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
        <p className="beer-form__notice" role="alert" data-testid="users-login-validation-error">
          {validationError}
        </p>
      )}
      {serverError && (
        <p className="beer-form__notice" role="alert" data-testid="users-login-server-error">
          {serverError}
        </p>
      )}
      <div className="beer-form__actions">
        <button type="submit" className="beer-form__submit" disabled={submitting} data-testid="users-login-submit">
          {submitting ? 'Adding…' : 'Add login user'}
        </button>
        <button type="button" className="beer-form__cancel" disabled={submitting} onClick={onCancel} data-testid="users-login-cancel">
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Create-drinker-only-profile form (Task 8): no username/password — a leaderboard/
 * claim-a-pour identity with no admin access. */
function DrinkerProfileForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
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
      className="user-form"
      data-testid="users-drinker-form"
      aria-label="Add drinker profile"
      onSubmit={handleSubmit}
    >
      <h2 className="user-form__title font-display">Add drinker profile</h2>
      <p className="admin-page-quiet">No login — just a name for claiming pours and the leaderboard.</p>
      <div className="user-form__grid">
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
        <p className="beer-form__notice" role="alert" data-testid="users-drinker-validation-error">
          {validationError}
        </p>
      )}
      {serverError && (
        <p className="beer-form__notice" role="alert" data-testid="users-drinker-server-error">
          {serverError}
        </p>
      )}
      <div className="beer-form__actions">
        <button type="submit" className="beer-form__submit" disabled={submitting} data-testid="users-drinker-submit">
          {submitting ? 'Adding…' : 'Add drinker profile'}
        </button>
        <button type="button" className="beer-form__cancel" disabled={submitting} onClick={onCancel} data-testid="users-drinker-cancel">
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Edit form (Task 8): display name + avatar color for every user; role + optional
 * password only for a login user (a drinker-only profile has neither — see UsersPage's
 * doc comment). Matches the plan's exact edit-field list. */
function EditUserForm({ user, onSaved, onCancel }: {
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
      className="user-form"
      data-testid="users-edit-form"
      aria-label={`Edit ${userLabel(user)}`}
      onSubmit={handleSubmit}
    >
      <h2 className="user-form__title font-display">Edit {userLabel(user)}</h2>
      <div className="user-form__grid">
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
        <p className="beer-form__notice" role="alert" data-testid="users-edit-validation-error">
          {validationError}
        </p>
      )}
      {serverError && (
        <p className="beer-form__notice" role="alert" data-testid="users-edit-server-error">
          {serverError}
        </p>
      )}
      <div className="beer-form__actions">
        <button type="submit" className="beer-form__submit" disabled={submitting} data-testid="users-edit-submit">
          {submitting ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" className="beer-form__cancel" disabled={submitting} onClick={onCancel} data-testid="users-edit-cancel">
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * `/admin/users` (Task 8, admin-only route — `AdminLayout` already bounces any non-admin
 * before this ever renders, so unlike most other Task 4-7 pages there's no `canEdit`/
 * viewer-read-only branching here).
 *
 * A user row is either a login account (`username` set, has a `role`, can sign in here)
 * or a drinker-only profile (`username: null`, `role: null` — a leaderboard/claim-a-pour
 * identity with no admin access). "Add user" opens a small chooser between the two —
 * they're different enough shapes (password + role vs. just a name + color) that a single
 * merged form would be confusing about which fields apply.
 *
 * Task 9 (Plan B) adds per-drinker face-data management: any drinker row with at least
 * one enrolled face sample shows the count plus a "Delete face data" button, wiping that
 * drinker's enrolled samples via the same public DELETE the tablet's own armed-screen
 * removal action uses (works even while face sign-in is globally disabled — see
 * routes/public.ts's doc comment on the route).
 */
export function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [status, setStatus] = useState<ListStatus>('loading');
  const [formState, setFormState] = useState<FormState | null>(null);
  const [deleteState, setDeleteState] = useState<DeleteState | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Task 9 (Plan B): per-drinker enrolled face-sample count (GET /api/faces/counts,
  // admin role) — a drinker absent from this map has zero samples (see
  // countFaceEmbeddingsByDrinker's doc comment, db/faceEmbeddings.ts). Loaded
  // independently of `users` (its own fetch, own refresh) since deleting face data never
  // changes the user list itself.
  const [faceCounts, setFaceCounts] = useState<Map<number, number>>(new Map());
  const [deletingFacesId, setDeletingFacesId] = useState<number | null>(null);

  const load = useCallback(() => {
    setStatus((s) => (s === 'loaded' ? s : 'loading'));
    listUsers().then((result) => {
      if (result.ok) {
        setUsers(result.data);
        setStatus('loaded');
      } else {
        setStatus('error');
      }
    });
  }, []);

  const loadFaceCounts = useCallback(() => {
    getFaceCounts().then((result) => {
      if (result.ok) setFaceCounts(new Map(result.data.map((c) => [c.drinkerId, c.count])));
    });
  }, []);

  useEffect(() => {
    load();
    loadFaceCounts();
  }, [load, loadFaceCounts]);

  async function handleDeleteFaces(drinkerId: number) {
    setDeletingFacesId(drinkerId);
    await deleteFaces(drinkerId);
    setDeletingFacesId(null);
    loadFaceCounts();
  }

  function handleSaved() {
    setFormState(null);
    load();
  }

  async function handleConfirmDelete() {
    if (!deleteState) return;
    setDeleting(true);
    const result = await deleteUser(deleteState.user.id);
    setDeleting(false);
    if (result.ok) {
      setDeleteState(null);
      load();
      return;
    }
    // db/users.ts's ConflictError message ("cannot delete the last admin") is a fine log
    // fragment but not a stand-alone sentence a bar owner should have to parse — surface
    // the plan's exact clear phrasing instead, with a concrete next step.
    setDeleteState({
      ...deleteState,
      error: result.status === 409
        ? "You can't delete the last admin — promote someone else to admin first."
        : result.message,
    });
  }

  return (
    <section data-testid="admin-users-page">
      <header className="admin-page-header">
        <h1 className="admin-page-header__title font-display">Users</h1>
        {!formState && (
          <button
            type="button"
            className="admin-page-header__action"
            data-testid="users-add-button"
            onClick={() => setFormState({ mode: 'choose' })}
          >
            Add user
          </button>
        )}
      </header>

      {formState?.mode === 'choose' && (
        <div
          className="user-form"
          data-testid="users-choose"
          role="dialog"
          aria-modal="true"
          aria-labelledby="users-choose-title"
        >
          <h2 id="users-choose-title" className="user-form__title font-display">Add user</h2>
          <p className="admin-page-quiet">
            Choose a login account (can sign in here) or a drinker-only profile (leaderboard
            identity only, no admin access).
          </p>
          <div className="beer-form__actions">
            <button
              type="button"
              className="beer-form__submit"
              data-testid="users-choose-login"
              onClick={() => setFormState({ mode: 'create-login' })}
            >
              Login user
            </button>
            <button
              type="button"
              className="beer-form__submit"
              data-testid="users-choose-drinker"
              onClick={() => setFormState({ mode: 'create-drinker' })}
            >
              Drinker profile
            </button>
            <button
              type="button"
              className="beer-form__cancel"
              data-testid="users-choose-cancel"
              onClick={() => setFormState(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {formState?.mode === 'create-login' && (
        <LoginUserForm onSaved={handleSaved} onCancel={() => setFormState(null)} />
      )}
      {formState?.mode === 'create-drinker' && (
        <DrinkerProfileForm onSaved={handleSaved} onCancel={() => setFormState(null)} />
      )}
      {formState?.mode === 'edit' && (
        <EditUserForm key={formState.user.id} user={formState.user} onSaved={handleSaved} onCancel={() => setFormState(null)} />
      )}

      {status === 'loading' && <p className="admin-page-quiet" data-testid="users-loading">Loading…</p>}
      {status === 'error' && (
        <p className="admin-page-quiet" role="alert" data-testid="users-error">
          Couldn&rsquo;t load users. Reload to try again.
        </p>
      )}
      {status === 'loaded' && users.length === 0 && (
        <p className="admin-page-quiet" data-testid="users-empty">No users yet.</p>
      )}

      {status === 'loaded' && users.length > 0 && (
        <table className="admin-table users-table" data-testid="users-list">
          <thead>
            <tr>
              <th scope="col" aria-label="Avatar" />
              <th scope="col">Name</th>
              <th scope="col">Login</th>
              <th scope="col">Drinker</th>
              <th scope="col" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} data-testid="users-row">
                <td>
                  <span
                    className="users-avatar-dot"
                    data-testid="users-row-avatar"
                    style={{ backgroundColor: user.avatarColor ?? 'var(--text-dim)' }}
                    aria-hidden="true"
                  />
                </td>
                <td className="font-body">
                  {user.displayName}
                  {user.username && (
                    <span className="users-row__username" data-testid="users-row-username">
                      {' '}
                      @{user.username}
                    </span>
                  )}
                </td>
                <td>
                  {user.role ? (
                    <span
                      className={`users-role-badge users-role-badge--${user.role}`}
                      data-testid="users-row-role"
                    >
                      {ROLE_LABELS[user.role]}
                    </span>
                  ) : (
                    <span className="users-role-badge users-role-badge--none" data-testid="users-row-role">
                      No login
                    </span>
                  )}
                </td>
                <td>
                  {user.isDrinker ? (
                    <span className="users-drinker-pill" data-testid="users-row-drinker">Drinker</span>
                  ) : (
                    <span className="admin-page-quiet" data-testid="users-row-drinker-none">—</span>
                  )}
                  {user.isDrinker && (faceCounts.get(user.id) ?? 0) > 0 && (
                    <div className="users-row__face-data">
                      <span className="admin-page-quiet" data-testid="users-row-face-count">
                        {faceCounts.get(user.id)} face samples
                      </span>
                      <button
                        type="button"
                        data-testid="face-data-delete"
                        disabled={deletingFacesId === user.id}
                        onClick={() => handleDeleteFaces(user.id)}
                      >
                        {deletingFacesId === user.id ? 'Deleting…' : 'Delete face data'}
                      </button>
                    </div>
                  )}
                </td>
                <td className="users-table__actions">
                  <button
                    type="button"
                    data-testid="users-row-edit"
                    onClick={() => setFormState({ mode: 'edit', user })}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    data-testid="users-row-delete"
                    onClick={() => setDeleteState({ user, error: null })}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {deleteState && (
        <div
          className="admin-confirm__backdrop"
          data-testid="users-delete-confirm"
          onClick={() => !deleting && setDeleteState(null)}
        >
          <div
            className="admin-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="users-delete-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="users-delete-title" className="font-display">Delete user</h3>
            <p>
              This will permanently delete {userLabel(deleteState.user)}
              {deleteState.user.username ? ` (@${deleteState.user.username})` : ''}.
              {deleteState.user.isDrinker
                ? ' Their past pours stay on record but are unlinked from this profile.'
                : ''} This can&rsquo;t be undone.
            </p>
            {deleteState.error && (
              <p role="alert" data-testid="users-delete-error">{deleteState.error}</p>
            )}
            <div className="admin-confirm__actions">
              <button
                type="button"
                data-testid="users-delete-confirm-button"
                disabled={deleting}
                onClick={handleConfirmDelete}
              >
                {deleting ? 'Deleting…' : 'Delete user'}
              </button>
              <button
                type="button"
                data-testid="users-delete-cancel-button"
                disabled={deleting}
                onClick={() => setDeleteState(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
