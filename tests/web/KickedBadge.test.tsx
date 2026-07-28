import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KickedBadge } from '../../src/web/components/KickedBadge';

describe('KickedBadge', () => {
  it('renders a "Kicked" stamp', () => {
    render(<KickedBadge />);
    expect(screen.getByText('Kicked')).toBeInTheDocument();
  });

  it('exposes a status role for assistive tech', () => {
    render(<KickedBadge />);
    expect(screen.getByRole('status')).toHaveTextContent('Kicked');
  });

  it('merges an extra className onto the root element', () => {
    render(<KickedBadge className="tap-card__kicked-badge" />);
    expect(screen.getByRole('status').className).toMatch(/tap-card__kicked-badge/);
  });
});
