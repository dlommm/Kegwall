import {
  describe, expect, it, vi, afterEach,
} from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import App from '../../src/web/App';

// Smoke test: proves the jsdom test harness (vitest project + @testing-library/react
// + @testing-library/jest-dom) actually renders React components, and exercises the
// router shell's "unknown route -> /menu" contract from Task 1.
describe('App', () => {
  // Public routes are lazy chunks (Kegwall V2 M1), so each assertion awaits the chunk.
  it('renders the menu placeholder at /menu', async () => {
    render(
      <MemoryRouter initialEntries={['/menu']}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText(/menu/i)).toBeInTheDocument(), { timeout: 15_000 });
  });

  it('routes /wall/:slug to WallPage (its own suite covers WallPage\'s actual behavior)', async () => {
    render(
      <MemoryRouter initialEntries={['/wall/main']}>
        <App />
      </MemoryRouter>,
    );

    // Real WallPage now does real data fetching (no api/hook mocks at this App-level
    // smoke test), so the only deterministic, synchronously-observable state is its
    // loading placeholder — this is enough to prove the router matched /wall/:slug and
    // rendered WallPage rather than MenuPage or the unknown-route redirect.
    expect(await screen.findByTestId('wall-page-loading', {}, { timeout: 15_000 })).toBeInTheDocument();
  });

  it('redirects unknown routes to /menu', async () => {
    render(
      <MemoryRouter initialEntries={['/nope']}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText(/menu/i)).toBeInTheDocument(), { timeout: 15_000 });
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

      // Generous timeout: resolving the real (large) lazy AdminApp chunk through
      // vite-node under a fully-parallel suite run repeatedly blew findBy's 1s
      // default on loaded machines (local AND CI) — a pure scheduling flake, the
      // same class as the lookup-test budgets. 15s is nowhere near the 30s global.
      expect(await screen.findByTestId('login-page', {}, { timeout: 15_000 })).toBeInTheDocument();
    });
  });
});
