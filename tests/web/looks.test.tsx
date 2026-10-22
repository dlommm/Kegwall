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

  it('renders a look that is not built yet as classic', () => {
    renderLook(makeConfig({ look: 'tally' }), [makeTap(1)]);
    expect(screen.getByTestId('look-classic')).toBeInTheDocument();
  });
});

describe('label art wires into card/column/style looks too (redesign 1b)', () => {
  function tapWithLabel(id: number, labelImage: string | null): TapState {
    const t = makeTap(id);
    return { ...t, beer: { ...t.beer!, labelImage } };
  }

  it.each(['poster', 'neon', 'chalkboard', 'editorial', 'terminal', 'departures', 'zen'] as const)(
    'the %s look renders the label image when the field is on', (look) => {
      renderLook(
        makeConfig({ look, fields: { labelImage: true } }),
        [tapWithLabel(1, '/labels/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png')],
      );
      expect(screen.getByTestId('look-label-art').getAttribute('src')).toContain('/labels/');
    },
  );

  it.each(['poster', 'zen'] as const)(
    'the %s look renders NO label slot when the field is off', (look) => {
      renderLook(makeConfig({ look }), [tapWithLabel(1, '/labels/x.png')]);
      expect(screen.queryByTestId('look-label-art')).toBeNull();
      expect(screen.queryByTestId('look-label-art-empty')).toBeNull();
    },
  );
});
