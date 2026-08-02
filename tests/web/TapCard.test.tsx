import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import { render, screen } from '@testing-library/react';
import { act } from 'react';
import type { TapState } from '../../src/server/core/state';
import type { Beer } from '../../src/server/db/beers';
import type { Keg } from '../../src/server/db/kegs';
import { TapCard } from '../../src/web/components/TapCard';
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

function makeBeer(overrides: Partial<Beer> = {}): Beer {
  return {
    id: 1,
    name: 'Hazy Trail IPA',
    brewery: 'Ridgeline Brewing',
    style: 'New England IPA',
    abv: 6.8,
    ibu: 45,
    srm: 6,
    description: 'Juicy and soft, loaded with citrus and stone fruit hop character.',
    labelImage: '/labels/hazy-trail.png',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

type WallKeg = Keg & { levelPct: number; remainingMl: number };

function makeKeg(overrides: Partial<WallKeg> = {}): WallKeg {
  return {
    id: 1,
    beerId: 1,
    tapId: 1,
    sizeMl: 19_500,
    volStartMl: 19_500,
    volDispensedMl: 9_750,
    dateTapped: '2026-07-01T00:00:00.000Z',
    status: 'on_tap',
    createdAt: '2026-07-01T00:00:00.000Z',
    kegType: null, costCents: null,
    levelPct: 50,
    remainingMl: 9_750,
    ...overrides,
  };
}

function makeTap(overrides: Partial<TapState> = {}): TapState {
  return {
    tapId: 1,
    tapNumber: 3,
    tapName: null,
    beer: makeBeer(),
    keg: makeKeg(),
    lastPour: { ts: '2026-07-28T11:56:00.000Z', volumeMl: 450 },
    pouring: false,
    curServMl: null,
    monitorOnline: true, hidden: false,
    temp: null,
    avgRating: null,
    nextUpBeerName: null,
    ...overrides,
  };
}

describe('TapCard', () => {
  afterEach(() => {
    // @ts-expect-error -- restore jsdom's undefined-by-default matchMedia between tests
    delete window.matchMedia;
    vi.useRealTimers();
  });

  it('renders the beer name in every template', () => {
    mockReducedMotion(false);
    for (const template of ['full', 'standard', 'compact', 'minimal'] as const) {
      const { unmount } = render(<TapCard tap={makeTap()} template={template} />);
      expect(screen.getByTestId('tap-card-name')).toHaveTextContent('Hazy Trail IPA');
      unmount();
    }
  });

  it('shows a quiet empty state for a tap with nothing on it', () => {
    mockReducedMotion(false);
    render(<TapCard tap={makeTap({ beer: null, keg: null })} />);
    expect(screen.getByTestId('tap-card-empty')).toHaveTextContent('Tap 3 — nothing on tap');
    expect(screen.queryByTestId('tap-card-name')).not.toBeInTheDocument();
  });

  it('passes the beer SRM through to the liquid fill as a real color', () => {
    mockReducedMotion(false);
    render(<TapCard tap={makeTap({ beer: makeBeer({ srm: 28 }) })} />);
    expect(screen.getByTestId('liquid-fill-body').getAttribute('fill')).toBe(srmToColor(28).liquid);
  });

  it('renders a per-pint price chip only when a price is supplied (redesign 4k)', () => {
    mockReducedMotion(false);
    const { rerender } = render(<TapCard tap={makeTap()} />);
    expect(screen.queryByTestId('tap-card-price')).not.toBeInTheDocument();
    rerender(<TapCard tap={makeTap()} pricePerPintCents={450} />);
    expect(screen.getByTestId('tap-card-price')).toHaveTextContent('$4.50 / pint');
  });

  it('formats the running pour readout per the units prop while pouring', () => {
    mockReducedMotion(false);
    render(
      <TapCard
        tap={makeTap({ pouring: true, curServMl: 148 })}
        units="metric"
      />,
    );
    expect(screen.getByTestId('liquid-readout')).toHaveTextContent(formatVolumeMl(148, 'metric'));
  });

  describe('field visibility per template', () => {
    it('full shows label art, brewery, style, description, ABV, IBU and last pour', () => {
      mockReducedMotion(false);
      render(<TapCard tap={makeTap()} template="full" />);
      expect(screen.getByTestId('tap-card-label-image')).toBeInTheDocument();
      expect(screen.getByTestId('tap-card-brewery')).toHaveTextContent('Ridgeline Brewing');
      expect(screen.getByTestId('tap-card-style')).toHaveTextContent('New England IPA');
      expect(screen.getByTestId('tap-card-description')).toBeInTheDocument();
      expect(screen.getByTestId('tap-card-abv')).toHaveTextContent('6.8% ABV');
      expect(screen.getByTestId('tap-card-ibu')).toHaveTextContent('45 IBU');
      expect(screen.getByTestId('tap-card-last-pour')).toBeInTheDocument();
    });

    it('standard shows everything full does except the description', () => {
      mockReducedMotion(false);
      render(<TapCard tap={makeTap()} template="standard" />);
      expect(screen.getByTestId('tap-card-brewery')).toBeInTheDocument();
      expect(screen.getByTestId('tap-card-abv')).toBeInTheDocument();
      expect(screen.queryByTestId('tap-card-description')).not.toBeInTheDocument();
    });

    it('compact is a dense row: style + ABV only, no brewery/description/IBU/last-pour/label art', () => {
      mockReducedMotion(false);
      render(<TapCard tap={makeTap()} template="compact" />);
      expect(screen.getByTestId('tap-card-style')).toBeInTheDocument();
      expect(screen.getByTestId('tap-card-abv')).toBeInTheDocument();
      expect(screen.queryByTestId('tap-card-brewery')).not.toBeInTheDocument();
      expect(screen.queryByTestId('tap-card-description')).not.toBeInTheDocument();
      expect(screen.queryByTestId('tap-card-ibu')).not.toBeInTheDocument();
      expect(screen.queryByTestId('tap-card-last-pour')).not.toBeInTheDocument();
      expect(screen.queryByTestId('tap-card-label-image')).not.toBeInTheDocument();
    });

    it('minimal shows only the name and the liquid fill', () => {
      mockReducedMotion(false);
      render(<TapCard tap={makeTap()} template="minimal" />);
      expect(screen.getByTestId('tap-card-name')).toBeInTheDocument();
      expect(screen.getByTestId('liquid-fill')).toBeInTheDocument();
      expect(screen.queryByTestId('tap-card-brewery')).not.toBeInTheDocument();
      expect(screen.queryByTestId('tap-card-style')).not.toBeInTheDocument();
      expect(screen.queryByTestId('tap-card-description')).not.toBeInTheDocument();
      expect(screen.queryByTestId('tap-card-abv')).not.toBeInTheDocument();
      expect(screen.queryByTestId('tap-card-ibu')).not.toBeInTheDocument();
      expect(screen.queryByTestId('tap-card-last-pour')).not.toBeInTheDocument();
    });

    it('an explicit fields override wins over the template default', () => {
      mockReducedMotion(false);
      render(<TapCard tap={makeTap()} template="minimal" fields={{ abv: true }} />);
      expect(screen.getByTestId('tap-card-abv')).toHaveTextContent('6.8% ABV');
      // Everything else minimal doesn't show stays hidden.
      expect(screen.queryByTestId('tap-card-brewery')).not.toBeInTheDocument();
    });

    it('an explicit fields override can hide a field a template shows by default', () => {
      mockReducedMotion(false);
      render(<TapCard tap={makeTap()} template="full" fields={{ brewery: false }} />);
      expect(screen.queryByTestId('tap-card-brewery')).not.toBeInTheDocument();
      expect(screen.getByTestId('tap-card-style')).toBeInTheDocument();
    });

    it('hides a field when the underlying data is missing even if the template shows it', () => {
      mockReducedMotion(false);
      render(<TapCard tap={makeTap({ beer: makeBeer({ brewery: null, ibu: null }) })} template="full" />);
      expect(screen.queryByTestId('tap-card-brewery')).not.toBeInTheDocument();
      expect(screen.queryByTestId('tap-card-ibu')).not.toBeInTheDocument();
    });
  });

  describe('kicked keg', () => {
    it('renders the Kicked stamp and drains the liquid to empty', () => {
      mockReducedMotion(false);
      render(<TapCard tap={makeTap({ keg: makeKeg({ status: 'kicked', levelPct: 70 }) })} />);
      expect(screen.getByText('Kicked')).toBeInTheDocument();
      expect(screen.getByTestId('liquid-fill-body').getAttribute('height')).toBe('0');
    });

    // `.tap-card__kicked-badge` is styled `position: absolute; inset: 0` in
    // index.css, sized against the nearest positioned ancestor. jsdom doesn't
    // load external stylesheets or run layout, so it can't verify the actual
    // visual containment (Task 7's screenshot audit does that) — but it *can*
    // verify the structural precondition that CSS fix depends on: the badge
    // must be a DOM descendant of `.tap-card__liquid` (data-testid
    // "tap-card-liquid"), not a sibling of it or a direct child of the card
    // root, or `inset: 0` sizes against the wrong element (see index.css's
    // `.tap-card__liquid { position: relative }` comment).
    it('nests the Kicked badge inside the liquid wrapper, not the card root', () => {
      mockReducedMotion(false);
      render(<TapCard tap={makeTap({ keg: makeKeg({ status: 'kicked' }) })} />);
      const liquidWrapper = screen.getByTestId('tap-card-liquid');
      const badge = screen.getByRole('status');
      expect(liquidWrapper).toContainElement(badge);
    });

    it('marks the card as desaturated via a kicked modifier class', () => {
      mockReducedMotion(false);
      render(<TapCard tap={makeTap({ keg: makeKeg({ status: 'kicked' }) })} />);
      expect(screen.getByTestId('tap-card').className).toMatch(/kicked/);
    });

    it('never shows a kicked keg as pouring', () => {
      mockReducedMotion(false);
      render(
        <TapCard tap={makeTap({ keg: makeKeg({ status: 'kicked' }), pouring: true, curServMl: 100 })} />,
      );
      expect(screen.queryByTestId('liquid-readout')).not.toBeInTheDocument();
    });

    it('still shows the beer name for a kicked tap (it just stopped pouring, not disappeared)', () => {
      mockReducedMotion(false);
      render(<TapCard tap={makeTap({ keg: makeKeg({ status: 'kicked' }) })} />);
      expect(screen.getByTestId('tap-card-name')).toHaveTextContent('Hazy Trail IPA');
    });

    // Phase 3 final review, finding I2: the absolute-positioned Kicked stamp is sized
    // against `.tap-card__liquid`, which in `compact` is a 28x40px swatch — far too small
    // to contain the stamp, so it overflows onto the neighbouring "TAP N" label. Compact
    // gets an inline text pill next to the beer name instead; every other template keeps
    // the stamp unchanged.
    describe('compact template', () => {
      it('renders an inline Kicked pill next to the beer name instead of the stamp', () => {
        mockReducedMotion(false);
        render(<TapCard tap={makeTap({ keg: makeKeg({ status: 'kicked' }) })} template="compact" />);
        expect(screen.getByTestId('tap-card-kicked-pill')).toHaveTextContent('Kicked');
      });

      it('does not render the absolute-positioned stamp badge', () => {
        mockReducedMotion(false);
        render(<TapCard tap={makeTap({ keg: makeKeg({ status: 'kicked' }) })} template="compact" />);
        // The stamp badge (KickedBadge) exposes role="status" — compact must not render it.
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
      });

      it('omits the pill entirely when the tap is not kicked', () => {
        mockReducedMotion(false);
        render(<TapCard tap={makeTap()} template="compact" />);
        expect(screen.queryByTestId('tap-card-kicked-pill')).not.toBeInTheDocument();
      });
    });

    it('still renders the absolute-positioned stamp badge for full/standard/minimal (unchanged)', () => {
      mockReducedMotion(false);
      for (const template of ['full', 'standard', 'minimal'] as const) {
        const { unmount } = render(
          <TapCard tap={makeTap({ keg: makeKeg({ status: 'kicked' }) })} template={template} />,
        );
        expect(screen.getByRole('status')).toHaveTextContent('Kicked');
        expect(screen.queryByTestId('tap-card-kicked-pill')).not.toBeInTheDocument();
        unmount();
      }
    });
  });

  describe('last-pour relative time', () => {
    it('renders "N min ago" and updates on the 30s interval', () => {
      vi.useFakeTimers();
      const now = new Date('2026-07-28T12:00:00.000Z');
      vi.setSystemTime(now);
      mockReducedMotion(false);

      render(
        <TapCard
          tap={makeTap({ lastPour: { ts: '2026-07-28T11:56:00.000Z', volumeMl: 450 } })}
          template="full"
        />,
      );
      expect(screen.getByTestId('tap-card-last-pour')).toHaveTextContent('4 min ago');

      act(() => {
        vi.setSystemTime(new Date(now.getTime() + 60_000));
        vi.advanceTimersByTime(30_000);
      });
      expect(screen.getByTestId('tap-card-last-pour')).toHaveTextContent('5 min ago');
    });

    it('omits the last-pour line when there is no recorded pour', () => {
      mockReducedMotion(false);
      render(<TapCard tap={makeTap({ lastPour: null })} template="full" />);
      expect(screen.queryByTestId('tap-card-last-pour')).not.toBeInTheDocument();
    });

    it('clears its relative-time interval on unmount', () => {
      vi.useFakeTimers();
      mockReducedMotion(false);
      const { unmount } = render(<TapCard tap={makeTap()} template="full" />);
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('prefers-reduced-motion', () => {
    it('omits the pouring/ripple animation classes from the liquid fill', () => {
      mockReducedMotion(true);
      render(<TapCard tap={makeTap({ pouring: true, curServMl: 50 })} />);
      expect(screen.getByTestId('liquid-fill').className).not.toMatch(/pouring/);
      expect(screen.getByTestId('liquid-fill-foam').getAttribute('class')).not.toMatch(/ripple/);
    });
  });

  describe('fillStyle (keg-asset fill indicator feature)', () => {
    it("defaults to LiquidFill when fillStyle is omitted", () => {
      mockReducedMotion(false);
      render(<TapCard tap={makeTap()} template="standard" />);
      expect(screen.getByTestId('liquid-fill')).toBeInTheDocument();
      expect(screen.queryByTestId('keg-fill')).not.toBeInTheDocument();
    });

    it("renders KegFill instead of LiquidFill when fillStyle is 'keg', for full/standard/minimal", () => {
      mockReducedMotion(false);
      for (const template of ['full', 'standard', 'minimal'] as const) {
        const { unmount } = render(
          <TapCard tap={makeTap()} template={template} fillStyle="keg" />,
        );
        expect(screen.getByTestId('keg-fill')).toBeInTheDocument();
        expect(screen.queryByTestId('liquid-fill')).not.toBeInTheDocument();
        unmount();
      }
    });

    it("compact ALWAYS renders LiquidFill (the small swatch), even when fillStyle is 'keg'", () => {
      mockReducedMotion(false);
      render(<TapCard tap={makeTap()} template="compact" fillStyle="keg" />);
      expect(screen.getByTestId('liquid-fill')).toBeInTheDocument();
      expect(screen.queryByTestId('keg-fill')).not.toBeInTheDocument();
    });

    it('passes the keg size and kegType override through to KegFill for asset resolution', () => {
      mockReducedMotion(false);
      render(
        <TapCard
          tap={makeTap({ keg: makeKeg({ sizeMl: 58674, kegType: 'mini-keg' }) })}
          fillStyle="keg"
        />,
      );
      expect(screen.getByTestId('keg-fill')).toHaveAttribute('data-asset', 'mini-keg');
    });

    it('auto-matches the asset by sizeMl when the keg has no kegType override', () => {
      mockReducedMotion(false);
      render(
        <TapCard
          tap={makeTap({ keg: makeKeg({ sizeMl: 58674, kegType: null }) })}
          fillStyle="keg"
        />,
      );
      expect(screen.getByTestId('keg-fill')).toHaveAttribute('data-asset', 'half-barrel');
    });

    it('drains KegFill to 0% for a kicked keg, same as LiquidFill', () => {
      mockReducedMotion(false);
      render(
        <TapCard
          tap={makeTap({ keg: makeKeg({ status: 'kicked', levelPct: 70 }) })}
          fillStyle="keg"
        />,
      );
      expect(screen.getByTestId('keg-fill-percent')).toHaveTextContent('0%');
      expect(screen.getByTestId('keg-fill-overlay').style.height).toBe('0%');
    });

    it('formats the running pour readout on KegFill per the units prop while pouring', () => {
      mockReducedMotion(false);
      render(
        <TapCard
          tap={makeTap({ pouring: true, curServMl: 148 })}
          fillStyle="keg"
          units="metric"
        />,
      );
      expect(screen.getByTestId('keg-fill-readout')).toHaveTextContent(formatVolumeMl(148, 'metric'));
    });
  });
});
