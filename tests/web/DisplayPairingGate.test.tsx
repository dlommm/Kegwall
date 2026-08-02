import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { DisplayPairingGate } from '../../src/web/components/DisplayPairingGate';
import { getMenu } from '../../src/web/lib/api';

vi.mock('../../src/web/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/web/lib/api')>()),
  getMenu: vi.fn(),
}));

beforeEach(() => { vi.clearAllMocks(); });

function renderGate() {
  return render(
    <MemoryRouter initialEntries={['/wall/main']}>
      <Routes>
        <Route
          path="/wall/:slug"
          element={<DisplayPairingGate><div data-testid="wall">WALL</div></DisplayPairingGate>}
        />
        <Route path="/display" element={<div data-testid="pairing">PAIR HERE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DisplayPairingGate', () => {
  it('renders the page and never redirects when the probe is OK (enforcement off / paired)', async () => {
    (getMenu as any).mockResolvedValue({ ok: true, data: { taps: [] } });
    renderGate();
    expect(screen.getByTestId('wall')).toBeInTheDocument(); // rendered immediately, no blank
    await waitFor(() => expect(getMenu).toHaveBeenCalled());
    expect(screen.queryByTestId('pairing')).toBeNull();
  });

  it('redirects to /display when the probe returns 401 (enforced + unpaired)', async () => {
    (getMenu as any).mockResolvedValue({ ok: false, status: 401, message: 'This display must be paired' });
    renderGate();
    await waitFor(() => expect(screen.getByTestId('pairing')).toBeInTheDocument());
    expect(screen.queryByTestId('wall')).toBeNull();
  });

  it('does not redirect on a non-401 failure (e.g. network error)', async () => {
    (getMenu as any).mockResolvedValue({ ok: false, status: 0, message: 'Network error' });
    renderGate();
    await waitFor(() => expect(getMenu).toHaveBeenCalled());
    expect(screen.getByTestId('wall')).toBeInTheDocument();
    expect(screen.queryByTestId('pairing')).toBeNull();
  });
});
