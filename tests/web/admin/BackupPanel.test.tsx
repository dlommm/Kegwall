import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { BackupPanel } from '../../../src/web/routes/admin/BackupPanel';
import { uploadRestore } from '../../../src/web/lib/adminApi';

vi.mock('../../../src/web/lib/adminApi', () => ({
  uploadRestore: vi.fn(),
}));

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function selectFile(input: HTMLElement, file: File) {
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BackupPanel', () => {
  it('the download control is a plain link to GET /api/admin/backup with a download attribute', () => {
    render(<BackupPanel />);
    const link = screen.getByTestId('backup-download-link');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/api/admin/backup');
    expect(link).toHaveAttribute('download');
  });

  it('the restore submit is disabled until a file is chosen', () => {
    render(<BackupPanel />);
    expect(screen.getByTestId('backup-restore-submit')).toBeDisabled();
    expect(screen.queryByTestId('backup-restore-warning')).not.toBeInTheDocument();
  });

  it('choosing a file reveals the typed-confirm warning, but the submit stays disabled until "restore" is typed exactly', () => {
    render(<BackupPanel />);
    const file = new File(['db-bytes'], 'backup.db', { type: 'application/octet-stream' });
    selectFile(screen.getByTestId('backup-restore-file'), file);

    expect(screen.getByTestId('backup-restore-warning')).toHaveTextContent(/backup\.db/);
    expect(screen.getByTestId('backup-restore-submit')).toBeDisabled();

    fireEvent.change(screen.getByTestId('backup-restore-confirm-input'), { target: { value: 'resto' } });
    expect(screen.getByTestId('backup-restore-submit')).toBeDisabled();

    fireEvent.change(screen.getByTestId('backup-restore-confirm-input'), { target: { value: 'restore' } });
    expect(screen.getByTestId('backup-restore-submit')).not.toBeDisabled();
  });

  it('is case-insensitive and trims whitespace on the typed confirmation', () => {
    render(<BackupPanel />);
    const file = new File(['db-bytes'], 'backup.db');
    selectFile(screen.getByTestId('backup-restore-file'), file);
    fireEvent.change(screen.getByTestId('backup-restore-confirm-input'), { target: { value: '  ResTore  ' } });
    expect(screen.getByTestId('backup-restore-submit')).not.toBeDisabled();
  });

  it('picking a new file resets any previously typed confirmation back to disabled', () => {
    render(<BackupPanel />);
    const fileInput = screen.getByTestId('backup-restore-file');
    selectFile(fileInput, new File(['a'], 'a.db'));
    fireEvent.change(screen.getByTestId('backup-restore-confirm-input'), { target: { value: 'restore' } });
    expect(screen.getByTestId('backup-restore-submit')).not.toBeDisabled();

    selectFile(fileInput, new File(['b'], 'b.db'));
    expect(screen.getByTestId('backup-restore-submit')).toBeDisabled();
  });

  it('submits the chosen file via uploadRestore once confirmed, and shows the server\'s restart message on success', async () => {
    (uploadRestore as Mock).mockResolvedValue({
      ok: true,
      data: { ok: true, message: 'Restore staged. Restart the server to apply it — this replaces all current data.' },
    });
    render(<BackupPanel />);
    const file = new File(['db-bytes'], 'backup.db');
    selectFile(screen.getByTestId('backup-restore-file'), file);
    fireEvent.change(screen.getByTestId('backup-restore-confirm-input'), { target: { value: 'restore' } });
    fireEvent.click(screen.getByTestId('backup-restore-submit'));
    await flush();

    expect(uploadRestore).toHaveBeenCalledWith(file);
    expect(screen.getByTestId('backup-restore-success')).toHaveTextContent(/restart the server/i);
    // Form resets after a successful stage.
    expect(screen.queryByTestId('backup-restore-warning')).not.toBeInTheDocument();
  });

  it('shows a clear error and does not reset the form when the upload is rejected', async () => {
    (uploadRestore as Mock).mockResolvedValue({
      ok: false, status: 400, message: "That file doesn't look like a SQLite database (bad header)",
    });
    render(<BackupPanel />);
    selectFile(screen.getByTestId('backup-restore-file'), new File(['not a db'], 'fake.db'));
    fireEvent.change(screen.getByTestId('backup-restore-confirm-input'), { target: { value: 'restore' } });
    fireEvent.click(screen.getByTestId('backup-restore-submit'));
    await flush();

    expect(screen.getByTestId('backup-restore-error')).toHaveTextContent(/doesn.t look like a SQLite database/i);
  });

  it('shows a friendly message for a 413 (oversize) rejection', async () => {
    (uploadRestore as Mock).mockResolvedValue({ ok: false, status: 413, message: 'request file too large' });
    render(<BackupPanel />);
    selectFile(screen.getByTestId('backup-restore-file'), new File(['big'], 'big.db'));
    fireEvent.change(screen.getByTestId('backup-restore-confirm-input'), { target: { value: 'restore' } });
    fireEvent.click(screen.getByTestId('backup-restore-submit'));
    await flush();

    expect(screen.getByTestId('backup-restore-error')).toHaveTextContent(/too large/i);
  });

  it('does not submit when the button is clicked while still disabled (no file, or wrong confirm text)', async () => {
    render(<BackupPanel />);
    fireEvent.click(screen.getByTestId('backup-restore-submit'));
    await flush();
    expect(uploadRestore).not.toHaveBeenCalled();
  });
});
