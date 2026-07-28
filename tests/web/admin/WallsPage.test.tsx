import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { WallsPage } from '../../../src/web/routes/admin/WallsPage';
import { getMe, listWalls, deleteWall } from '../../../src/web/lib/adminApi';
import type { Wall } from '../../../src/web/lib/adminApi';
import type { User } from '../../../src/server/db/users';
import { wallConfigSchema } from '../../../src/server/core/wallConfig';

vi.mock('../../../src/web/lib/adminApi', () => ({
  getMe: vi.fn(),
  listWalls: vi.fn(),
  createWall: vi.fn(),
  deleteWall: vi.fn(),
}));

vi.mock('../../../src/web/routes/admin/WallEditor', () => ({
  WallEditor: (props: { wall: Wall; onBack: () => void; onSaved: (w: Wall) => void }) => (
    <div data-testid="mock-wall-editor">
      <span data-testid="mock-wall-editor-name">{props.wall.name}</span>
      <button type="button" data-testid="mock-wall-editor-back" onClick={props.onBack}>Back</button>
    </div>
  ),
}));

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function makeWall(overrides: Partial<Wall> = {}): Wall {
  return {
    id: 1, slug: 'main-bar', name: 'Main bar', config: wallConfigSchema.parse({}), ...overrides,
  };
}

function makeUser(role: User['role']): User {
  return {
    id: 1, username: 'u', displayName: 'U', role, isDrinker: false, avatarColor: null,
    createdAt: '2026-07-28T00:00:00.000Z',
  };
}

const originalLocation = window.location;

beforeEach(() => {
  vi.clearAllMocks();
  (getMe as Mock).mockResolvedValue({ ok: true, data: makeUser('editor') });
  (listWalls as Mock).mockResolvedValue({ ok: true, data: [] });
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, origin: 'https://taproom.example' },
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

describe('WallsPage', () => {
  it('renders one row per wall with name, slug, and the full wall URL', async () => {
    (listWalls as Mock).mockResolvedValue({
      ok: true,
      data: [makeWall({ id: 1, slug: 'main-bar', name: 'Main bar' })],
    });
    render(<WallsPage />);
    const rows = await screen.findAllByTestId('walls-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Main bar');
    expect(rows[0]).toHaveTextContent('main-bar');
    expect(rows[0]).toHaveTextContent('https://taproom.example/wall/main-bar');
  });

  it('shows a quiet empty state with no walls', async () => {
    render(<WallsPage />);
    expect(await screen.findByTestId('walls-empty')).toBeInTheDocument();
  });

  it('copy button writes the wall URL to the clipboard and shows brief confirmation', async () => {
    (listWalls as Mock).mockResolvedValue({ ok: true, data: [makeWall({ slug: 'main-bar' })] });
    render(<WallsPage />);
    await screen.findAllByTestId('walls-row');

    fireEvent.click(screen.getByTestId('walls-row-copy'));
    await flush();

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://taproom.example/wall/main-bar');
    expect(screen.getByTestId('walls-row-copy')).toHaveTextContent(/copied/i);
  });

  it('the open-in-new-tab link points at the wall URL and opens in a new tab', async () => {
    (listWalls as Mock).mockResolvedValue({ ok: true, data: [makeWall({ slug: 'main-bar' })] });
    render(<WallsPage />);
    await screen.findAllByTestId('walls-row');
    const link = screen.getByTestId('walls-row-open');
    expect(link).toHaveAttribute('href', 'https://taproom.example/wall/main-bar');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
  });

  it('Preview toggles an inline read-only iframe, available even to a viewer', async () => {
    (getMe as Mock).mockResolvedValue({ ok: true, data: makeUser('viewer') });
    (listWalls as Mock).mockResolvedValue({ ok: true, data: [makeWall({ slug: 'main-bar' })] });
    render(<WallsPage />);
    await screen.findAllByTestId('walls-row');

    expect(screen.queryByTestId('wall-preview-frame')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('walls-row-preview'));
    expect(screen.getByTestId('wall-preview-frame')).toHaveAttribute('src', '/wall/main-bar');
  });

  it('a viewer sees a read-only list: no Add wall button, no Edit/Delete controls', async () => {
    (getMe as Mock).mockResolvedValue({ ok: true, data: makeUser('viewer') });
    (listWalls as Mock).mockResolvedValue({ ok: true, data: [makeWall()] });
    render(<WallsPage />);
    await screen.findAllByTestId('walls-row');
    expect(screen.queryByTestId('walls-add-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('walls-row-edit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('walls-row-delete')).not.toBeInTheDocument();
    // Copy/open/preview are still visible read-only affordances.
    expect(screen.getByTestId('walls-row-copy')).toBeInTheDocument();
  });

  it('an editor can open the create form, and creating adds the wall then closes the form', async () => {
    const { createWall } = await import('../../../src/web/lib/adminApi');
    (createWall as Mock).mockResolvedValue({ ok: true, data: makeWall({ id: 2, slug: 'patio', name: 'Patio' }) });
    render(<WallsPage />);
    await flush();

    fireEvent.click(screen.getByTestId('walls-add-button'));
    expect(screen.getByTestId('walls-create-form')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('walls-create-name'), { target: { value: 'Patio' } });
    fireEvent.change(screen.getByTestId('walls-create-slug'), { target: { value: 'patio' } });
    fireEvent.click(screen.getByTestId('walls-create-submit'));
    await flush();

    expect(createWall).toHaveBeenCalledWith({ name: 'Patio', slug: 'patio' });
    expect(screen.queryByTestId('walls-create-form')).not.toBeInTheDocument();
    expect(listWalls).toHaveBeenCalledTimes(2); // initial + post-create refresh
  });

  it('the create form auto-suggests a slug from the name until the slug is hand-edited', async () => {
    render(<WallsPage />);
    await flush();
    fireEvent.click(screen.getByTestId('walls-add-button'));

    fireEvent.change(screen.getByTestId('walls-create-name'), { target: { value: 'Front Patio Bar' } });
    expect(screen.getByTestId('walls-create-slug')).toHaveValue('front-patio-bar');

    fireEvent.change(screen.getByTestId('walls-create-slug'), { target: { value: 'custom-slug' } });
    fireEvent.change(screen.getByTestId('walls-create-name'), { target: { value: 'Front Patio Bar 2' } });
    expect(screen.getByTestId('walls-create-slug')).toHaveValue('custom-slug');
  });

  it('a create failure shows the server message and keeps the form open', async () => {
    const { createWall } = await import('../../../src/web/lib/adminApi');
    (createWall as Mock).mockResolvedValue({ ok: false, status: 409, message: 'slug already in use' });
    render(<WallsPage />);
    await flush();
    fireEvent.click(screen.getByTestId('walls-add-button'));
    fireEvent.change(screen.getByTestId('walls-create-name'), { target: { value: 'Patio' } });
    fireEvent.click(screen.getByTestId('walls-create-submit'));
    await flush();

    expect(screen.getByTestId('walls-create-error')).toHaveTextContent('slug already in use');
    expect(screen.getByTestId('walls-create-form')).toBeInTheDocument();
  });

  it('clicking Edit swaps the list for the (mocked) wall editor', async () => {
    (listWalls as Mock).mockResolvedValue({ ok: true, data: [makeWall({ name: 'Main bar' })] });
    render(<WallsPage />);
    await screen.findAllByTestId('walls-row');
    fireEvent.click(screen.getByTestId('walls-row-edit'));
    expect(screen.getByTestId('mock-wall-editor')).toBeInTheDocument();
    expect(screen.getByTestId('mock-wall-editor-name')).toHaveTextContent('Main bar');
    expect(screen.queryByTestId('walls-list')).not.toBeInTheDocument();
  });

  it('the editor\'s Back control returns to the list and refreshes it', async () => {
    (listWalls as Mock).mockResolvedValue({ ok: true, data: [makeWall()] });
    render(<WallsPage />);
    await screen.findAllByTestId('walls-row');
    fireEvent.click(screen.getByTestId('walls-row-edit'));
    expect(listWalls).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('mock-wall-editor-back'));
    await flush();
    expect(screen.getByTestId('walls-list')).toBeInTheDocument();
    expect(listWalls).toHaveBeenCalledTimes(2);
  });

  it('delete shows a full consequence sentence naming the wall and its URL (never a bare "are you sure")', async () => {
    (listWalls as Mock).mockResolvedValue({ ok: true, data: [makeWall({ name: 'Main bar', slug: 'main-bar' })] });
    render(<WallsPage />);
    await screen.findAllByTestId('walls-row');
    fireEvent.click(screen.getByTestId('walls-row-delete'));
    const confirm = screen.getByTestId('walls-delete-confirm');
    expect(confirm).toHaveTextContent('This will permanently delete');
    expect(confirm).toHaveTextContent('Main bar');
    expect(confirm).toHaveTextContent(/wall\/main-bar/);
    expect(confirm).toHaveTextContent("can’t be undone");
    expect(confirm.textContent).not.toMatch(/^Are you sure\?$/);
  });

  it('a successful delete closes the confirmation and reloads the list', async () => {
    (listWalls as Mock).mockResolvedValue({ ok: true, data: [makeWall()] });
    (deleteWall as Mock).mockResolvedValue({ ok: true, data: null });
    render(<WallsPage />);
    await screen.findAllByTestId('walls-row');
    fireEvent.click(screen.getByTestId('walls-row-delete'));
    fireEvent.click(screen.getByTestId('walls-delete-confirm-button'));
    await flush();
    expect(deleteWall).toHaveBeenCalledWith(1);
    expect(screen.queryByTestId('walls-delete-confirm')).not.toBeInTheDocument();
    expect(listWalls).toHaveBeenCalledTimes(2);
  });

  it('a delete failure shows the message and keeps the dialog open', async () => {
    (listWalls as Mock).mockResolvedValue({ ok: true, data: [makeWall()] });
    (deleteWall as Mock).mockResolvedValue({ ok: false, status: 500, message: 'Something went wrong' });
    render(<WallsPage />);
    await screen.findAllByTestId('walls-row');
    fireEvent.click(screen.getByTestId('walls-row-delete'));
    fireEvent.click(screen.getByTestId('walls-delete-confirm-button'));
    await flush();
    expect(screen.getByTestId('walls-delete-error')).toHaveTextContent('Something went wrong');
    expect(screen.getByTestId('walls-delete-confirm')).toBeInTheDocument();
  });

  it('canceling the delete dialog leaves the wall intact', async () => {
    (listWalls as Mock).mockResolvedValue({ ok: true, data: [makeWall()] });
    render(<WallsPage />);
    await screen.findAllByTestId('walls-row');
    fireEvent.click(screen.getByTestId('walls-row-delete'));
    fireEvent.click(screen.getByTestId('walls-delete-cancel-button'));
    expect(screen.queryByTestId('walls-delete-confirm')).not.toBeInTheDocument();
    expect(deleteWall).not.toHaveBeenCalled();
  });
});
