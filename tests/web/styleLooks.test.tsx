import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { wallConfigSchema, type WallConfig } from '../../src/server/core/wallConfig';
import { WallLook } from '../../src/web/components/looks/WallLook';
import { posterInk, asciiBar } from '../../src/web/components/looks/styleLooks';
import type { TapState } from '../../src/server/core/state';
import { srmToColor } from '../../src/web/lib/srm';

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
    monitorOnline: true,
    temp: null,
    locationId: null,
    avgRating: null,
    nextUpBeerName: null,
    ...overrides,
  };
}

function renderLook(look: WallConfig['look'], taps: TapState[], configOverrides: Record<string, unknown> = {}) {
  return render(
    <WallLook
      taps={taps}
      config={wallConfigSchema.parse({ look, ...configOverrides })}
      units="us"
      title="Halfmoon Brewing"
      menuUrl="http://wall.local/menu"
      tempC={1.1}
      pageIndex={0}
      pageCount={1}
      rotationSeconds={12}
    />,
  );
}

describe('turn-8 look helpers', () => {
  it('posterInk flips black/white by SRM luminance', () => {
    expect(posterInk('#F6F513')).toBe('#14100B'); // pale pilsner → dark ink
    expect(posterInk('#040504')).toBe('#F3EAD9'); // stout black → light ink
  });

  it('asciiBar renders the 10-cell level bar', () => {
    expect(asciiBar(78)).toBe('████████░░');
    expect(asciiBar(0)).toBe('░░░░░░░░░░');
    expect(asciiBar(100)).toBe('██████████');
  });
});

describe('the turn-8 looks all render with % remaining (design rule)', () => {
  it.each([
    ['chalkboard', 'chalkboard-look', 'chalk-row'],
    ['editorial', 'editorial-look', 'editorial-row'],
    ['neon', 'neon-look', 'neon-card'],
    ['terminal', 'terminal-look', 'terminal-row'],
    ['poster', 'poster-look', 'poster-row'],
    ['departures', 'departures-look', 'departures-row'],
    ['zen', 'zen-look', 'zen-row'],
  ] as const)('%s renders rows with the level percent', (look, rootId, rowId) => {
    const { unmount } = renderLook(look, [makeTap(1), makeTap(2)]);
    expect(screen.getByTestId(rootId)).toBeInTheDocument();
    const rows = screen.getAllByTestId(rowId);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('78%');
    unmount();
  });
});

describe('look voices', () => {
  it('chalkboard shows the Caveat menu with outline glassware and ticker footer', () => {
    renderLook('chalkboard', [makeTap(1)], { ticker: 'trivia thursdays 7pm' });
    expect(screen.getByTestId('srm-glass')).toHaveAttribute('data-mode', 'outline');
    expect(screen.getByText('trivia thursdays 7pm')).toBeInTheDocument();
    expect(screen.getByText(/No\. 1 · Hazy IPA · 58 IBU · 78% left/)).toBeInTheDocument();
  });

  it('editorial numbers rows 01… and says REMAINS', () => {
    renderLook('editorial', [makeTap(1)]);
    expect(screen.getByText('01')).toBeInTheDocument();
    expect(screen.getByTestId('editorial-remains')).toHaveTextContent('78% REMAINS');
  });

  it('terminal renders the ASCII bar and og/abv stats', () => {
    renderLook('terminal', [makeTap(1)]);
    expect(screen.getByTestId('terminal-bar')).toHaveTextContent('[████████░░]');
    expect(screen.getByText('abv=6.8%')).toBeInTheDocument();
    expect(screen.getByText('og=1.064')).toBeInTheDocument();
  });

  it("poster rows carry the beer's real SRM background with auto ink", () => {
    renderLook('poster', [makeTap(1)]);
    const row = screen.getByTestId('poster-row');
    const hex = srmToColor(5).liquid;
    const rgb = `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
    expect(row.style.backgroundColor).toBe(rgb);
    expect(screen.getByTestId('poster-specs')).toHaveTextContent('78%▮');
  });

  it('departures status column: POURING / LOW / ON TIME', () => {
    const pouring = makeTap(1, { pouring: true, curServMl: 200 });
    const low = makeTap(2);
    low.keg = { ...low.keg!, levelPct: 12, remainingMl: 19000 * 0.12 };
    renderLook('departures', [pouring, low, makeTap(3)]);
    const statuses = screen.getAllByTestId('departures-status');
    expect(statuses[0]).toHaveTextContent('● POURING');
    expect(statuses[1]).toHaveTextContent('▲ LOW');
    expect(statuses[2]).toHaveTextContent('ON TIME');
  });

  it('zen shows the count word, SRM dot, hairline and small %', () => {
    renderLook('zen', [makeTap(1), makeTap(2), makeTap(3)]);
    expect(screen.getByText('HALFMOON BREWING — THREE ON TAP')).toBeInTheDocument();
    expect(screen.getAllByTestId('zen-pct')[0]).toHaveTextContent('78%');
  });

  it('every non-classic look id resolves to a component', () => {
    const looks: WallConfig['look'][] = [
      'ledger', 'gallery', 'columns', 'chalkboard', 'editorial', 'neon', 'terminal', 'poster', 'departures', 'zen',
    ];
    for (const look of looks) {
      const { container, unmount } = renderLook(look, [makeTap(1)]);
      expect(container.firstChild, `look ${look} rendered nothing`).not.toBeNull();
      unmount();
    }
  });
});
