import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BannerLane } from '../../src/web/components/BannerLane';
import type { Banner } from '../../src/web/lib/useBanners';

describe('BannerLane', () => {
  it('renders nothing visible when the queue is empty', () => {
    render(<BannerLane queue={[]} onDismiss={vi.fn()} />);
    expect(screen.queryByTestId('banner-lane-banner')).not.toBeInTheDocument();
  });

  it('renders only the front banner of the queue', () => {
    const queue: Banner[] = [
      { id: 'a', text: 'First', kind: 'info' },
      { id: 'b', text: 'Second', kind: 'info' },
    ];
    render(<BannerLane queue={queue} onDismiss={vi.fn()} />);
    expect(screen.getByTestId('banner-lane-banner')).toHaveTextContent('First');
    expect(screen.queryByText('Second')).not.toBeInTheDocument();
  });

  it('tags the banner with its kind for styling', () => {
    const queue: Banner[] = [{ id: 'a', text: 'Kicked: Citra IPA', kind: 'warning' }];
    render(<BannerLane queue={queue} onDismiss={vi.fn()} />);
    expect(screen.getByTestId('banner-lane-banner')).toHaveAttribute('data-kind', 'warning');
  });

  it('calls onDismiss with the front banner id when its dismiss control is activated', () => {
    const onDismiss = vi.fn();
    const queue: Banner[] = [{ id: 'a', text: 'First', kind: 'info' }];
    render(<BannerLane queue={queue} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledWith('a');
  });
});
