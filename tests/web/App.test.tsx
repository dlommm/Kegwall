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

  it('renders the wall placeholder with the slug from the URL', () => {
    render(
      <MemoryRouter initialEntries={['/wall/main']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText(/main/i)).toBeInTheDocument();
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
