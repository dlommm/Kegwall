import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { wallConfigSchema } from '../../src/server/core/wallConfig';
import { WallLook } from '../../src/web/components/looks/WallLook';
import type { TapState } from '../../src/server/core/state';
import { classicDensity, kegFillColor } from '../../src/web/wall/looks/ClassicLook';
import { spotlightNameSize } from '../../src/web/wall/looks/JustTappedLook';
import { kicksInLabel, pickSpotlight, tappedLabel } from '../../src/web/wall/looks/lookKit';
import { wallTapModel } from '../../src/web/wall/wallModel';

vi.mock('../../src/web/lib/usePrefersReducedMotion', () => ({ usePrefersReducedMotion: () => false }));

const DAY = 86_400_000;
function tap(n: number, over: { name?: string; levelPct?: number; daysAgo?: number; kicked?: boolean; pouring?: boolean; nextUp?: string } = {}): TapState {
  const levelPct = over.levelPct ?? 50;
  return {
    tapId: n, tapNumber: n, tapName: null,
    beer: {
      id: n, name: over.name ?? `Beer ${n}`, brewery: 'Garage Brewing', style: 'Hazy IPA', abv: 6.8, ibu: 40, srm: 6,
      description: null, labelImage: null, createdAt: '',
    },
    keg: {
      id: n, beerId: n, tapId: n, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 19000 * (1 - levelPct / 100),
      dateTapped: new Date(Date.now() - (over.daysAgo ?? 20) * DAY).toISOString(), status: over.kicked ? 'kicked' : 'on_tap',
      createdAt: '', kegType: null, costCents: null, levelPct, remainingMl: 19000 * (levelPct / 100),
    },
    lastPour: null, pouring: over.pouring ?? false, curServMl: over.pouring ? 236 : null,
    monitorOnline: true, hidden: false, temp: 3, avgRating: null, nextUpBeerName: over.nextUp ?? null,
    tonight: { pours: 2, volumeMl: 800 }, lastHourPours: 1, kickDate: null,
  };
}

function renderLook(look: string, taps: TapState[], config: Record<string, unknown> = {}) {
  return render(
    <WallLook
      taps={taps}
      config={wallConfigSchema.parse({ look, showQr: true, header: { showClock: true, showTemp: true }, ...config })}
      units="us"
      servingSizeMl={473}
      title="Garage Brewing Co."
      menuUrl="http://wall.local/menu"
      tempC={3}
      pageIndex={0}
      pageCount={2}
      rotationSeconds={12}
    />,
  );
}

describe('Just Tapped', () => {
  it('gives the newest keg the spotlight field and lists the rest with pints left', () => {
    renderLook('just-tapped', [tap(1, { name: 'Citra Haze', daysAgo: 9 }), tap(6, { name: 'Kriek Reserve', daysAgo: 1 })]);
    const spot = screen.getByTestId('just-tapped-spotlight');
    expect(spot).toHaveTextContent('Kriek Reserve');
    expect(spot).toHaveTextContent('Just tapped on tap 6.');
    expect(screen.getByTestId('look-just-tapped')).toHaveTextContent('Citra Haze');
    expect(screen.getByTestId('look-meta')).toHaveTextContent('page 1 of 2');
    expect(screen.getByTestId('look-qr')).toBeInTheDocument();
  });

  it('honors a pinned spotlight tap', () => {
    renderLook('just-tapped', [tap(1, { name: 'Pinned Pils', daysAgo: 30 }), tap(2, { name: 'New One', daysAgo: 1 })], {
      spotlight: { mode: 'pinned', tapId: 1 },
    });
    expect(screen.getByTestId('just-tapped-spotlight')).toHaveTextContent('Pinned Pils');
  });

  it('moves kicked kegs into the footer sentence', () => {
    renderLook('just-tapped', [tap(1), tap(12, { name: 'Gourd Times', kicked: true, nextUp: 'Old Thunder' })]);
    expect(screen.getByTestId('look-just-tapped')).toHaveTextContent('Gourd Times kicked. Old Thunder goes on next.');
  });

  it('steps long names down so they fit', () => {
    expect(spotlightNameSize('Kriek')).toBe(196);
    expect(spotlightNameSize('The Extraordinarily Long-Named Double Dry-Hopped Imperial West Coast IPA')).toBe(88);
  });
});

describe('Classic', () => {
  it('composes by the density ladder', () => {
    expect(classicDensity(3)).toBe('hero');
    expect(classicDensity(8)).toBe('cards');
    expect(classicDensity(12)).toBe('rows');
  });

  it('fills each card to its keg level and states pints left', () => {
    renderLook('classic', [tap(1, { levelPct: 40 })]);
    const card = screen.getByTestId('classic-card');
    expect(card.style.getPropertyValue('--level')).toBe('0.4');
    expect(card).toHaveTextContent('16pints left');
  });

  it('uses a deep tone on dark themes and a pale tint on light ones', () => {
    expect(kegFillColor('#C8962E', 'dark')).not.toBe(kegFillColor('#C8962E', 'light'));
  });

  it('marks a kicked keg and names what is next', () => {
    renderLook('classic', [tap(1, { kicked: true, nextUp: 'Old Thunder' })]);
    expect(screen.getByTestId('classic-card')).toHaveAttribute('data-tap-state', 'kicked');
    expect(screen.getByTestId('classic-card')).toHaveTextContent('Kicked · next up Old Thunder');
  });
});

describe('Ledger', () => {
  it('writes when each keg went on, tonight, what is left and the kick forecast', () => {
    renderLook('ledger', [tap(1, { daysAgo: 0 })]);
    const look = screen.getByTestId('look-ledger');
    expect(look).toHaveTextContent('The cellar ledger');
    expect(look).toHaveTextContent('2 pours tonight');
    expect(look).toHaveTextContent('today');
    expect(look).toHaveTextContent('27 oz');
  });

  it('phrases dates and forecasts like a bartender', () => {
    const now = new Date(2026, 9, 22, 20);
    expect(tappedLabel(new Date(2026, 9, 22, 9).toISOString(), now)).toBe('today');
    expect(tappedLabel(new Date(2026, 9, 21, 9).toISOString(), now)).toBe('yesterday');
    expect(tappedLabel(new Date(2026, 9, 18, 9).toISOString(), now)).toBe('Sunday');
    expect(tappedLabel(new Date(2026, 9, 9, 9).toISOString(), now)).toBe('Oct 9');
    expect(kicksInLabel(1, false)).toBe('about a day');
    expect(kicksInLabel(5, false)).toBe('≈ 5 days');
    expect(kicksInLabel(null, true)).toBe('kicked');
  });
});

describe('Columns and Gallery', () => {
  it('draws one keg column per tap with pints left', () => {
    renderLook('columns', [tap(1), tap(2)]);
    const cols = screen.getAllByTestId('columns-col');
    expect(cols).toHaveLength(2);
    expect(within(cols[0]!).getByText(/pints left/)).toBeInTheDocument();
  });

  it('hangs each beer as a plate with a wall label', () => {
    renderLook('gallery', [tap(1, { name: 'Citra Haze' })]);
    expect(screen.getByTestId('look-gallery')).toHaveTextContent('Now showing at Garage Brewing Co.');
    expect(screen.getByTestId('look-gallery')).toHaveTextContent('≈ 20 pints left');
  });
});

describe('pickSpotlight', () => {
  const models = [tap(1, { daysAgo: 5 }), tap(2, { daysAgo: 1 }), tap(3, { daysAgo: 0, kicked: true })]
    .map((t) => wallTapModel(t, { units: 'us', servingSizeMl: 473 }));
  it('prefers the newest keg that is still pouring', () => {
    expect(pickSpotlight(models, { mode: 'newest', tapId: null })!.tapNumber).toBe(2);
  });
  it('falls back to newest when the pinned tap is kicked or missing', () => {
    expect(pickSpotlight(models, { mode: 'pinned', tapId: 3 })!.tapNumber).toBe(2);
    expect(pickSpotlight(models, { mode: 'pinned', tapId: 99 })!.tapNumber).toBe(2);
  });
});
