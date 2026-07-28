import { describe, expect, it } from 'vitest';
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
});
