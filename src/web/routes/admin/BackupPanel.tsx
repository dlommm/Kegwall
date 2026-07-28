import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { uploadRestore } from '../../lib/adminApi';

const CONFIRM_WORD = 'restore';

type RestoreResult = { type: 'success'; message: string } | { type: 'error'; message: string };

/**
 * The Settings page's Backup group (Task 8): a plain download link for `GET /api/admin/
 * backup` — a real top-level navigation (not a `fetch`+blob dance) so the browser handles
 * the `Content-Disposition: attachment` response exactly like any other file download,
 * cookies included automatically since it's same-origin — and a restore upload gated
 * behind the strongest confirm in the app, per the design direction: restoring replaces
 * ALL current data, so a bare "Are you sure?" isn't enough. The admin must pick a file
 * AND type the word "restore" (case-insensitive, matched after trimming) before the
 * submit button even enables.
 */
export function BackupPanel() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<RestoreResult | null>(null);

  const canSubmit = file != null
    && confirmText.trim().toLowerCase() === CONFIRM_WORD
    && !submitting;

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
    setConfirmText('');
    setResult(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file || confirmText.trim().toLowerCase() !== CONFIRM_WORD) return;
    setSubmitting(true);
    setResult(null);
    const res = await uploadRestore(file);
    setSubmitting(false);
    if (res.ok) {
      setResult({ type: 'success', message: res.data.message });
      setFile(null);
      setConfirmText('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setResult({
      type: 'error',
      message: res.status === 413 ? 'That file is too large (50MB max).' : res.message,
    });
  }

  return (
    <section className="settings-group" data-testid="backup-panel" aria-labelledby="backup-panel-title">
      <h2 id="backup-panel-title" className="admin-field__label-text">Backup</h2>

      <div className="backup-panel__block">
        <h3 className="backup-panel__block-title">Download a backup</h3>
        <p className="admin-page-quiet">
          Downloads a complete, consistent snapshot of everything — beers, taps, kegs, pours,
          users, and settings — as a single file.
        </p>
        <a
          className="admin-page-header__action backup-panel__download"
          href="/api/admin/backup"
          download
          data-testid="backup-download-link"
        >
          Download backup
        </a>
      </div>

      <form className="backup-panel__block" data-testid="backup-restore-form" onSubmit={handleSubmit}>
        <h3 className="backup-panel__block-title">Restore from a backup</h3>
        <p className="admin-page-quiet">
          Uploads a previously downloaded backup file and stages it to replace the current
          database the next time the server restarts.
        </p>
        <label className="admin-field">
          <span>Backup file</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".db"
            data-testid="backup-restore-file"
            onChange={handleFileChange}
          />
        </label>

        {file && (
          <div className="backup-panel__warning" data-testid="backup-restore-warning">
            <p>
              This replaces ALL current data on this device with &ldquo;{file.name}&rdquo;&rsquo;s contents
              the next time the server restarts. There&rsquo;s no undo once that happens. Type{' '}
              <strong>restore</strong> below to confirm.
            </p>
            <label className="admin-field">
              <span>Type &ldquo;restore&rdquo; to confirm</span>
              <input
                type="text"
                data-testid="backup-restore-confirm-input"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoComplete="off"
              />
            </label>
          </div>
        )}

        {result?.type === 'error' && (
          <p role="alert" data-testid="backup-restore-error">{result.message}</p>
        )}
        {result?.type === 'success' && (
          <p data-testid="backup-restore-success">{result.message}</p>
        )}

        <button
          type="submit"
          className="beer-form__submit"
          data-testid="backup-restore-submit"
          disabled={!canSubmit}
        >
          {submitting ? 'Uploading…' : 'Restore backup'}
        </button>
      </form>
    </section>
  );
}
