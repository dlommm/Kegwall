import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { wallConfigSchema, type WallConfig } from '../../src/server/core/wallConfig';
import { WallLook } from '../../src/web/components/looks/WallLook';
import type { TapState } from '../../src/server/core/state';

vi.mock('../../src/web/lib/usePrefersReducedMotion', () => ({
  usePrefersReducedMotion: () => false,
}));

function makeTap(tapId: number, overrides: Partial<TapState> = {}): TapState {
  return {
    tapId,
    tapNumber: tapId,
    tapName: null,
    beer: {
      id: tapId,
      name: `Beer ${tapId}`,
      brewery: 'Halfmoon Brewing',
      style: 'Hazy IPA',
      abv: 6.8,
      ibu: 58,
      srm: 5,
      description: 'Juicy and soft.',
      labelImage: null,
      createdAt: '',
    },
    keg: {
      id: tapId,
      beerId: tapId,
      tapId,
      sizeMl: 19000,
      volStartMl: 19000,
      volDispensedMl: 19000 * 0.22,
      dateTapped: null,
      status: 'on_tap',
      createdAt: '',
      kegType: null, costCents: null,
      levelPct: 78,
      remainingMl: 19000 * 0.78,
    },
    lastPour: null,
    pouring: false,
    curServMl: null,
    monitorOnline: true, hidden: false,
    temp: null,
    avgRating: null,
    nextUpBeerName: null, tonight: { pours: 0, volumeMl: 0 }, lastHourPours: 0, kickDate: null,
    ...overrides,
  };
}

function makeConfig(overrides: Record<string, unknown> = {}): WallConfig {
  return wallConfigSchema.parse(overrides);
}

function renderLook(config: WallConfig, taps: TapState[], extra: Partial<Parameters<typeof WallLook>[0]> = {}) {
  return render(
    <WallLook
      taps={taps}
      config={config}
      units="us"
      title="Halfmoon Brewing"
      menuUrl="http://wall.local/menu"
      tempC={1.1}
      pageIndex={0}
      pageCount={1}
      rotationSeconds={12}
      {...extra}
    />,
  );
}

describe('WallLook dispatch', () => {
  it.each([
    ['classic', 'look-classic'],
    ['just-tapped', 'look-just-tapped'],
    ['ledger', 'look-ledger'],
    ['gallery', 'look-gallery'],
    ['columns', 'look-columns'],
  ] as const)('renders the %s V2 stage look', (look, testId) => {
    renderLook(makeConfig({ look }), [makeTap(1)]);
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  });

  it.each([
    'chalkboard', 'editorial', 'neon', 'terminal', 'poster', 'departures', 'zen', 'handles', 'tally',
  ] as const)('renders the %s V2 stage look', (look) => {
    renderLook(makeConfig({ look }), [makeTap(1)]);
    expect(screen.getByTestId(`look-${look}`)).toBeInTheDocument();
  });
});

describe('label art (redesign 1b, carried into V2)', () => {
  it.each(['classic', 'just-tapped', 'ledger'] as const)(
    'the %s look shows uploaded label art in the tap marker', (look) => {
      const t = makeTap(1);
      renderLook(makeConfig({ look }), [{ ...t, beer: { ...t.beer!, labelImage: '/labels/x.png' } }]);
      expect(screen.getAllByTestId('tap-marker')[0]!.querySelector('img')).toHaveAttribute('src', '/labels/x.png');
    },
  );
});
