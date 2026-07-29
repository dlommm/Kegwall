import {
  describe, expect, it, vi, afterEach,
} from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../../src/web/App';

// Smoke test: proves the jsdom test harness (vitest project + @testing-library/react
// + @testing-library/jest-dom) actually renders React components, and exercises the
// router shell's "unknown route -> /menu" contract from Task 1.
describe('App', () => {
  it('renders the menu placeholder at /menu', () => {
    render(
      <MemoryRouter initialEntries={['/menu']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText(/menu/i)).toBeInTheDocument();
  });

  it('routes /wall/:slug to WallPage (its own suite covers WallPage\'s actual behavior)', () => {
    render(
      <MemoryRouter initialEntries={['/wall/main']}>
        <App />
      </MemoryRouter>,
    );

    // Real WallPage now does real data fetching (no api/hook mocks at this App-level
    // smoke test), so the only deterministic, synchronously-observable state is its
    // loading placeholder — this is enough to prove the router matched /wall/:slug and
    // rendered WallPage rather than MenuPage or the unknown-route redirect.
    expect(screen.getByTestId('wall-page-loading')).toBeInTheDocument();
  });

  it('redirects unknown routes to /menu', () => {
    render(
      <MemoryRouter initialEntries={['/nope']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText(/menu/i)).toBeInTheDocument();
  });

  // Phase 5 Task 0: /admin/* is lazy-loaded (React.lazy + Suspense — see App.tsx) so a
  // wall/menu client never fetches the admin chunk. Proves the boundary actually resolves
  // to a real admin page, not just that it doesn't crash — the async import must settle
  // before LoginPage (which itself does its own async needs-setup probe) appears.
  describe('/admin/* (lazy)', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('lazily resolves to the real admin route tree, e.g. rendering LoginPage at /admin/login', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true, status: 200, json: async () => ({ needsSetup: false }),
      } as Response));

      render(
        <MemoryRouter initialEntries={['/admin/login']}>
          <App />
        </MemoryRouter>,
      );

      expect(await screen.findByTestId('login-page')).toBeInTheDocument();
    });
  });
});
