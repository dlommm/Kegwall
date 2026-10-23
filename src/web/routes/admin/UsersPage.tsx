import { useCallback, useEffect, useState } from 'react';
import type { User } from '../../../server/db/users.js';
import { listUsers, deleteUser, getFaceCounts } from '../../lib/adminApi';
// Admin-initiated face-data deletion goes through the admin-gated DELETE /api/faces/
// drinker/:id — the public self-service delete is bound to the currently-armed kiosk
// pourer, which an admin at their desk isn't.
import { deleteFacesAdmin } from '../../lib/api';
import { initials } from '../../lib/initials';
import {
  DrinkerProfileForm, EditUserForm, LoginUserForm, ROLE_CAN, ROLE_LABELS, DEFAULT_AVATAR_COLOR,
} from './people/UserForms';
import {
  Button, ConfirmDialog, Drawer, EmptyState, ErrorState, Skeleton, Table,
} from './ui';

type ListStatus = 'loading' | 'loaded' | 'error';

type FormState =
  | { mode: 'choose' }
  | { mode: 'create-login' }
  | { mode: 'create-drinker' }
  | { mode: 'edit'; user: User };

interface DeleteState { user: User; error: string | null }

const FORM_TITLES: Record<Exclude<FormState['mode'], 'edit'>, string> = {
  choose: 'Add someone',
  'create-login': 'Add an account',
  'create-drinker': 'Add a pourer',
};

/**
 * The People page's Accounts tab, also served at `/admin/users` (admin-only route —
 * `AdminLayout` bounces any non-admin before this renders, so there's no viewer branch).
 *
 * A user row is either a login account (`username` set, has a `role`, can sign in here)
 * or a drinker-only profile (`username: null`, `role: null` — a leaderboard/claim-a-pour
 * identity with no admin access). "Add someone" opens a chooser between the two in a drawer —
 * they're different enough shapes (password + role vs. just a name + color) that a single
 * merged form would be confusing about which fields apply. Editing opens the same drawer.
 *
 * Any drinker with enrolled face samples shows the count and "Delete face data", which wipes
 * that drinker's samples through the admin DELETE (works even while face sign-in is off).
 */
/** `embedded` hides the standalone title so this sits under the People page's header + tabs. */
export function UsersPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [users, setUsers] = useState<User[]>([]);
  const [status, setStatus] = useState<ListStatus>('loading');
  const [formState, setFormState] = useState<FormState | null>(null);
  const [deleteState, setDeleteState] = useState<DeleteState | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Per-drinker enrolled face-sample count (GET /api/faces/counts, admin role) — a drinker
  // absent from this map has zero samples. Loaded independently of `users` since deleting
  // face data never changes the user list itself.
  const [faceCounts, setFaceCounts] = useState<Map<number, number>>(new Map());
  const [deletingFacesId, setDeletingFacesId] = useState<number | null>(null);
  const [faceDeleteError, setFaceDeleteError] = useState<{ drinkerId: number; message: string } | null>(null);

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
    setFaceDeleteError(null);
    const result = await deleteFacesAdmin(drinkerId);
    setDeletingFacesId(null);
    if (!result.ok) {
      setFaceDeleteError({ drinkerId, message: "Couldn't delete face data. Try again." });
    }
    // Refetch either way — server truth, never a stale optimistic count.
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
    setDeleteState({
      ...deleteState,
      error: result.status === 409
        ? "You can't delete the last admin — promote someone else to admin first."
        : result.message,
    });
  }

  const accounts = users.filter((u) => u.username != null);

  return (
    <section data-testid="admin-users-page">
      <div className="adm-toolbar">
        {embedded
          ? <h2 className="adm-h2 people-v2__h2">Everyone, and who can sign in</h2>
          : <h1 className="adm-page__title">{`${accounts.length} account${accounts.length === 1 ? '' : 's'} can sign in.`}</h1>}
        <Button variant="primary" data-testid="users-add-button" onClick={() => setFormState({ mode: 'choose' })}>
          Add someone
        </Button>
      </div>

      {formState && (
        <Drawer
          open
          onOpenChange={(open) => { if (!open) setFormState(null); }}
          title={formState.mode === 'edit' ? `Edit ${formState.user.displayName}` : FORM_TITLES[formState.mode]}
        >
          {formState.mode === 'choose' && (
            <div className="adm-form" data-testid="users-choose" role="group" aria-label="Who are you adding?">
              <button type="button" className="adm-option" data-testid="users-choose-login" onClick={() => setFormState({ mode: 'create-login' })}>
                <span aria-hidden="true" />
                <span>
                  <b>An account</b>
                  <span className="adm-sub" style={{ display: 'block' }}>
                    A username and password that can sign in to this admin, as admin, editor or viewer.
                  </span>
                </span>
                <span />
              </button>
              <button type="button" className="adm-option" data-testid="users-choose-drinker" onClick={() => setFormState({ mode: 'create-drinker' })}>
                <span aria-hidden="true" />
                <span>
                  <b>A pourer</b>
                  <span className="adm-sub" style={{ display: 'block' }}>
                    Just a name and color for claiming pours and the leaderboard. No sign-in.
                  </span>
                </span>
                <span />
              </button>
              <Button variant="quiet" data-testid="users-choose-cancel" onClick={() => setFormState(null)} style={{ alignSelf: 'flex-start' }}>
                Cancel
              </Button>
            </div>
          )}
          {formState.mode === 'create-login' && (
            <LoginUserForm onSaved={handleSaved} onCancel={() => setFormState(null)} />
          )}
          {formState.mode === 'create-drinker' && (
            <DrinkerProfileForm onSaved={handleSaved} onCancel={() => setFormState(null)} />
          )}
          {formState.mode === 'edit' && (
            <EditUserForm key={formState.user.id} user={formState.user} onSaved={handleSaved} onCancel={() => setFormState(null)} />
          )}
        </Drawer>
      )}

      {status === 'loading' && <div data-testid="users-loading"><Skeleton height={44} /></div>}
      {status === 'error' && (
        <div data-testid="users-error"><ErrorState title="Couldn’t load accounts." onRetry={load}>Reload to try again.</ErrorState></div>
      )}
      {status === 'loaded' && users.length === 0 && (
        <div data-testid="users-empty"><EmptyState title="No one yet." /></div>
      )}

      {status === 'loaded' && users.length > 0 && (
        <Table data-testid="users-list">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Can</th>
              <th scope="col">Profile</th>
              <th scope="col"><span className="adm-sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const faces = faceCounts.get(user.id) ?? 0;
              return (
                <tr key={user.id} data-testid="users-row">
                  <td>
                    <div className="adm-who">
                      <span
                        className="people-v2__avatar"
                        data-testid="users-row-avatar"
                        style={{ backgroundColor: user.avatarColor ?? DEFAULT_AVATAR_COLOR }}
                        aria-hidden="true"
                      >
                        {initials(user.displayName)}
                      </span>
                      <div>
                        <b>{user.displayName}</b>
                        {user.username && (
                          <div className="adm-sub" data-testid="users-row-username">@{user.username}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span data-testid="users-row-role"><b>{user.role ? ROLE_LABELS[user.role] : 'No login'}</b></span>
                    <div className="adm-sub">{user.role ? ROLE_CAN[user.role] : 'Claims pours and appears on the leaderboard'}</div>
                  </td>
                  <td>
                    {user.isDrinker
                      ? <span data-testid="users-row-drinker">Drinker</span>
                      : <span className="adm-sub" data-testid="users-row-drinker-none">—</span>}
                    {user.isDrinker && faces > 0 && (
                      <div className="people-v2__faces">
                        <span className="adm-sub" data-testid="users-row-face-count">{faces} face samples</span>
                        <Button
                          variant="quiet"
                          data-testid="face-data-delete"
                          disabled={deletingFacesId === user.id}
                          onClick={() => handleDeleteFaces(user.id)}
                        >
                          {deletingFacesId === user.id ? 'Deleting…' : 'Delete face data'}
                        </Button>
                        {faceDeleteError?.drinkerId === user.id && (
                          <p className="adm-danger-text" role="alert" data-testid="face-data-delete-error">{faceDeleteError.message}</p>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="adm-actions">
                    <Button variant="quiet" data-testid="users-row-edit" onClick={() => setFormState({ mode: 'edit', user })}>
                      Edit
                    </Button>
                    <Button variant="quiet" data-testid="users-row-delete" onClick={() => setDeleteState({ user, error: null })}>
                      Delete
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      <ConfirmDialog
        open={deleteState !== null}
        onOpenChange={(open) => { if (!open) setDeleteState(null); }}
        title={deleteState ? `Delete ${deleteState.user.displayName}?` : ''}
        confirmLabel="Delete"
        busyLabel="Deleting…"
        busy={deleting}
        error={deleteState?.error}
        onConfirm={handleConfirmDelete}
        testId="users-delete-confirm"
        confirmTestId="users-delete-confirm-button"
        cancelTestId="users-delete-cancel-button"
        errorTestId="users-delete-error"
      >
        {deleteState && (
          <p>
            This will permanently delete {deleteState.user.displayName}
            {deleteState.user.username ? ` (@${deleteState.user.username})` : ''}.
            {deleteState.user.isDrinker
              ? ' Their past pours stay on record but are unlinked from this profile.'
              : ''} This can&rsquo;t be undone.
          </p>
        )}
      </ConfirmDialog>
    </section>
  );
}
