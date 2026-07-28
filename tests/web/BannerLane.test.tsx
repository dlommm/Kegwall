import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BannerLane } from '../../src/web/components/BannerLane';
import type { Banner } from '../../src/web/lib/useBanners';

function mockReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches,
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
}

describe('BannerLane', () => {
  afterEach(() => {
    // @ts-expect-error -- restore jsdom's undefined-by-default matchMedia between tests
    delete window.matchMedia;
  });

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

  describe('prefers-reduced-motion', () => {
    it('applies the animated (slide-in) class when motion is allowed', () => {
      mockReducedMotion(false);
      const queue: Banner[] = [{ id: 'a', text: 'First', kind: 'info' }];
      render(<BannerLane queue={queue} onDismiss={vi.fn()} />);
      expect(screen.getByTestId('banner-lane-banner').className).toMatch(/--animated/);
    });

    it('omits the animated (slide-in) class under prefers-reduced-motion', () => {
      mockReducedMotion(true);
      const queue: Banner[] = [{ id: 'a', text: 'First', kind: 'info' }];
      render(<BannerLane queue={queue} onDismiss={vi.fn()} />);
      expect(screen.getByTestId('banner-lane-banner').className).not.toMatch(/--animated/);
    });
  });
});
