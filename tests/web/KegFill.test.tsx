import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import { render, screen } from '@testing-library/react';
import { KegFill } from '../../src/web/components/KegFill';
import { levelToColor } from '../../src/web/lib/fillColor';
import { resolveKegAsset } from '../../src/web/lib/kegAssets';
import { formatVolumeMl } from '../../src/web/lib/units';

function mockReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches,
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
}

describe('KegFill', () => {
  afterEach(() => {
    // @ts-expect-error -- restore jsdom's undefined-by-default matchMedia between tests
    delete window.matchMedia;
  });

  it('auto-selects the keg asset by nearest sizeMl match when no override is given', () => {
    mockReducedMotion(false);
    render(<KegFill levelPct={50} sizeMl={58674} kegType={null} pouring={false} curServMl={null} />);
    expect(screen.getByTestId('keg-fill')).toHaveAttribute('data-asset', 'half-barrel');
  });

  it('an explicit kegType override wins over the size-based auto-match', () => {
    mockReducedMotion(false);
    render(<KegFill levelPct={50} sizeMl={58674} kegType="mini-keg" pouring={false} curServMl={null} />);
    expect(screen.getByTestId('keg-fill')).toHaveAttribute('data-asset', 'mini-keg');
  });

  it('renders the resolved asset image', () => {
    mockReducedMotion(false);
    render(<KegFill levelPct={50} sizeMl={5000} kegType={null} pouring={false} curServMl={null} />);
    const asset = resolveKegAsset(5000, null);
    expect(screen.getByTestId('keg-fill-image')).toHaveAttribute('src', asset.src);
  });

  it('colors the fill overlay via levelToColor at the current level', () => {
    mockReducedMotion(false);
    render(<KegFill levelPct={72} sizeMl={19558} kegType={null} pouring={false} curServMl={null} />);
    const overlay = screen.getByTestId('keg-fill-overlay');
    // jsdom normalizes `background: hsl(...)` to an `rgb(...)` string on readback, so
    // compare against the SAME normalization rather than the raw hsl() string.
    const probe = document.createElement('div');
    probe.style.background = levelToColor(72);
    expect(overlay.style.background).toBe(probe.style.background);
  });

  it("sizes the fill overlay's height to the clamped level percent", () => {
    mockReducedMotion(false);
    const { rerender } = render(
      <KegFill levelPct={140} sizeMl={19558} kegType={null} pouring={false} curServMl={null} />,
    );
    expect(screen.getByTestId('keg-fill-overlay').style.height).toBe('100%');

    rerender(<KegFill levelPct={-20} sizeMl={19558} kegType={null} pouring={false} curServMl={null} />);
    expect(screen.getByTestId('keg-fill-overlay').style.height).toBe('0%');
  });

  it('renders the rounded percent number, always visible', () => {
    mockReducedMotion(false);
    render(<KegFill levelPct={63.4} sizeMl={19558} kegType={null} pouring={false} curServMl={null} />);
    expect(screen.getByTestId('keg-fill-percent')).toHaveTextContent('63%');
  });

  it('clamps the displayed percent to 0-100', () => {
    mockReducedMotion(false);
    const { rerender } = render(
      <KegFill levelPct={140} sizeMl={19558} kegType={null} pouring={false} curServMl={null} />,
    );
    expect(screen.getByTestId('keg-fill-percent')).toHaveTextContent('100%');
    rerender(<KegFill levelPct={-20} sizeMl={19558} kegType={null} pouring={false} curServMl={null} />);
    expect(screen.getByTestId('keg-fill-percent')).toHaveTextContent('0%');
  });

  it('shows a running pour readout, formatted per the units prop, while pouring', () => {
    mockReducedMotion(false);
    render(<KegFill levelPct={50} sizeMl={19558} kegType={null} pouring curServMl={148} units="us" />);
    expect(screen.getByTestId('keg-fill-readout')).toHaveTextContent(formatVolumeMl(148, 'us'));
  });

  it('omits the pour readout entirely when not pouring', () => {
    mockReducedMotion(false);
    render(<KegFill levelPct={50} sizeMl={19558} kegType={null} pouring={false} curServMl={148} />);
    expect(screen.queryByTestId('keg-fill-readout')).not.toBeInTheDocument();
  });

  it('applies a pouring-glow class to the container only while pouring', () => {
    mockReducedMotion(false);
    const { rerender } = render(
      <KegFill levelPct={50} sizeMl={19558} kegType={null} pouring={false} curServMl={null} />,
    );
    expect(screen.getByTestId('keg-fill').className).not.toMatch(/pouring/);

    rerender(<KegFill levelPct={50} sizeMl={19558} kegType={null} pouring curServMl={30} />);
    expect(screen.getByTestId('keg-fill').className).toMatch(/pouring/);
  });

  it('applies a smooth height-transition class to the fill overlay by default', () => {
    mockReducedMotion(false);
    render(<KegFill levelPct={50} sizeMl={19558} kegType={null} pouring={false} curServMl={null} />);
    expect(screen.getByTestId('keg-fill-overlay').getAttribute('class')).toMatch(/transition/);
  });

  it('renders a fully-drained (0%) overlay cleanly, e.g. for a kicked keg', () => {
    mockReducedMotion(false);
    render(<KegFill levelPct={0} sizeMl={19558} kegType={null} pouring={false} curServMl={null} />);
    expect(screen.getByTestId('keg-fill-overlay').style.height).toBe('0%');
    expect(screen.getByTestId('keg-fill-percent')).toHaveTextContent('0%');
  });

  describe('prefers-reduced-motion', () => {
    it('omits the pouring-glow class even while pouring', () => {
      mockReducedMotion(true);
      render(<KegFill levelPct={50} sizeMl={19558} kegType={null} pouring curServMl={30} />);
      expect(screen.getByTestId('keg-fill').className).not.toMatch(/pouring/);
    });

    it('omits the height-transition class, so level changes jump instead of animating', () => {
      mockReducedMotion(true);
      render(<KegFill levelPct={50} sizeMl={19558} kegType={null} pouring={false} curServMl={null} />);
      expect(screen.getByTestId('keg-fill-overlay').getAttribute('class')).not.toMatch(/transition/);
    });

    it('still shows the running pour readout (readout is text, not motion)', () => {
      mockReducedMotion(true);
      render(<KegFill levelPct={50} sizeMl={19558} kegType={null} pouring curServMl={148} units="us" />);
      expect(screen.getByTestId('keg-fill-readout')).toHaveTextContent(formatVolumeMl(148, 'us'));
    });
  });
});
