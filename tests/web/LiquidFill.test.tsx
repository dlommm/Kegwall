import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiquidFill } from '../../src/web/components/LiquidFill';
import { srmToColor } from '../../src/web/lib/srm';
import { formatVolumeMl } from '../../src/web/lib/units';

function mockReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches,
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
}

describe('LiquidFill', () => {
  afterEach(() => {
    // @ts-expect-error -- restore jsdom's undefined-by-default matchMedia between tests
    delete window.matchMedia;
  });

  it('tints the liquid body with the SRM-mapped color', () => {
    mockReducedMotion(false);
    render(<LiquidFill levelPct={60} srm={25} pouring={false} curServMl={null} />);
    const body = screen.getByTestId('liquid-fill-body');
    expect(body.getAttribute('fill')).toBe(srmToColor(25).liquid);
  });

  it('falls back to the neutral default tint for a null SRM', () => {
    mockReducedMotion(false);
    render(<LiquidFill levelPct={60} srm={null} pouring={false} curServMl={null} />);
    const body = screen.getByTestId('liquid-fill-body');
    expect(body.getAttribute('fill')).toBe(srmToColor(null).liquid);
  });

  it('renders the foam head line, tinted with the highlight color, when there is any liquid', () => {
    mockReducedMotion(false);
    render(<LiquidFill levelPct={45} srm={10} pouring={false} curServMl={null} />);
    const foam = screen.getByTestId('liquid-fill-foam');
    expect(foam.getAttribute('fill')).toBe(srmToColor(10).highlight);
  });

  it('omits the foam head line at 0% level', () => {
    mockReducedMotion(false);
    render(<LiquidFill levelPct={0} srm={10} pouring={false} curServMl={null} />);
    expect(screen.queryByTestId('liquid-fill-foam')).not.toBeInTheDocument();
  });

  it('clamps out-of-range levels to 0-100', () => {
    mockReducedMotion(false);
    const { rerender } = render(<LiquidFill levelPct={140} srm={10} pouring={false} curServMl={null} />);
    expect(screen.getByTestId('liquid-fill-body').getAttribute('height')).toBe('100');

    rerender(<LiquidFill levelPct={-20} srm={10} pouring={false} curServMl={null} />);
    expect(screen.getByTestId('liquid-fill-body').getAttribute('height')).toBe('0');
  });

  it('applies the ripple animation class to the foam line only while pouring', () => {
    mockReducedMotion(false);
    const { rerender } = render(<LiquidFill levelPct={50} srm={10} pouring={false} curServMl={0} />);
    expect(screen.getByTestId('liquid-fill-foam').getAttribute('class')).not.toMatch(/ripple/);

    rerender(<LiquidFill levelPct={50} srm={10} pouring curServMl={30} />);
    expect(screen.getByTestId('liquid-fill-foam').getAttribute('class')).toMatch(/ripple/);
  });

  it('applies a pouring-glow class to the container only while pouring', () => {
    mockReducedMotion(false);
    const { rerender } = render(<LiquidFill levelPct={50} srm={10} pouring={false} curServMl={null} />);
    expect(screen.getByTestId('liquid-fill').className).not.toMatch(/pouring/);

    rerender(<LiquidFill levelPct={50} srm={10} pouring curServMl={30} />);
    expect(screen.getByTestId('liquid-fill').className).toMatch(/pouring/);
  });

  it('shows a running pour readout, formatted per the units prop, while pouring', () => {
    mockReducedMotion(false);
    render(<LiquidFill levelPct={50} srm={10} pouring curServMl={148} units="us" />);
    expect(screen.getByTestId('liquid-readout')).toHaveTextContent(formatVolumeMl(148, 'us'));
  });

  it('formats the pour readout in metric mL when units is metric', () => {
    mockReducedMotion(false);
    render(<LiquidFill levelPct={50} srm={10} pouring curServMl={473} units="metric" />);
    expect(screen.getByTestId('liquid-readout')).toHaveTextContent('473 mL');
  });

  it('omits the pour readout entirely when not pouring', () => {
    mockReducedMotion(false);
    render(<LiquidFill levelPct={50} srm={10} pouring={false} curServMl={148} />);
    expect(screen.queryByTestId('liquid-readout')).not.toBeInTheDocument();
  });

  it('applies a smooth height-transition class to the liquid body by default', () => {
    mockReducedMotion(false);
    render(<LiquidFill levelPct={50} srm={10} pouring={false} curServMl={null} />);
    expect(screen.getByTestId('liquid-fill-body').getAttribute('class')).toMatch(/transition/);
  });

  describe('prefers-reduced-motion', () => {
    it('omits the ripple class even while pouring', () => {
      mockReducedMotion(true);
      render(<LiquidFill levelPct={50} srm={10} pouring curServMl={30} />);
      expect(screen.getByTestId('liquid-fill-foam').getAttribute('class')).not.toMatch(/ripple/);
    });

    it('omits the pouring-glow class even while pouring', () => {
      mockReducedMotion(true);
      render(<LiquidFill levelPct={50} srm={10} pouring curServMl={30} />);
      expect(screen.getByTestId('liquid-fill').className).not.toMatch(/pouring/);
    });

    it('omits the height-transition class, so level changes jump instead of animating', () => {
      mockReducedMotion(true);
      render(<LiquidFill levelPct={50} srm={10} pouring={false} curServMl={null} />);
      expect(screen.getByTestId('liquid-fill-body').getAttribute('class')).not.toMatch(/transition/);
    });

    it('still shows the running pour readout (readout is text, not motion)', () => {
      mockReducedMotion(true);
      render(<LiquidFill levelPct={50} srm={10} pouring curServMl={148} units="us" />);
      expect(screen.getByTestId('liquid-readout')).toHaveTextContent(formatVolumeMl(148, 'us'));
    });
  });
});
