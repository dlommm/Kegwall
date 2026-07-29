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
      kegType: null,
      levelPct: 78,
      remainingMl: 19000 * 0.78,
    },
    lastPour: null,
    pouring: false,
    curServMl: null,
    monitorOnline: true,
    temp: null,
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
  it('renders nothing for the classic look (WallPage owns that path)', () => {
    const { container } = renderLook(makeConfig({ look: 'classic' }), [makeTap(1)]);
    expect(container.firstChild).toBeNull();
  });

  it.each([
    ['ledger', 'ledger-look'],
    ['gallery', 'gallery-look'],
    ['columns', 'columns-look'],
  ] as const)('renders the %s look', (look, testId) => {
    renderLook(makeConfig({ look }), [makeTap(1)]);
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  });
});

describe('LedgerLook (1a)', () => {
  it('renders a row per tap with name, glyphs, and the % remaining line', () => {
    renderLook(makeConfig({ look: 'ledger' }), [makeTap(1), makeTap(2)]);
    expect(screen.getAllByTestId('ledger-row')).toHaveLength(2);
    expect(screen.getAllByTestId('srm-glass')).toHaveLength(2);
    expect(screen.getAllByTestId('hop-fill')).toHaveLength(2);
    expect(screen.getAllByTestId('abv-glasses')).toHaveLength(2);
    expect(screen.getAllByTestId('keg-silhouette')).toHaveLength(2);
    expect(screen.getAllByTestId('ledger-row-remaining')[0]).toHaveTextContent('501 oz · 78% left');
  });

  it('shows the estimated OG/BU:GU/kcal data cells', () => {
    renderLook(makeConfig({ look: 'ledger' }), [makeTap(1)]);
    expect(screen.getByText('1.064 OG')).toBeInTheDocument();
    expect(screen.getByText('0.91 BU:GU')).toBeInTheDocument();
    expect(screen.getByText('204 kcal / 12 oz')).toBeInTheDocument();
    expect(screen.getByText('58 IBU')).toBeInTheDocument();
    expect(screen.getByText('5.0 SRM')).toBeInTheDocument();
  });

  it('renders badges: NEW ON TAP, ALMOST GONE and the live POURING counter', () => {
    const fresh = makeTap(1);
    fresh.keg = { ...fresh.keg!, dateTapped: new Date().toISOString() };
    const low = makeTap(2);
    low.keg = { ...low.keg!, levelPct: 12, remainingMl: 19000 * 0.12 };
    const pouring = makeTap(3, { pouring: true, curServMl: 366.7 });
    renderLook(makeConfig({ look: 'ledger' }), [fresh, low, pouring]);
    expect(screen.getByTestId('look-badge-new')).toHaveTextContent('NEW ON TAP');
    expect(screen.getByTestId('look-badge-low')).toHaveTextContent('ALMOST GONE');
    expect(screen.getByTestId('look-badge-pouring')).toHaveTextContent('POURING · 12.4 oz');
  });

  it('renders the header announcement, clock, sensor chip, ticker and QR when configured', () => {
    renderLook(makeConfig({
      look: 'ledger',
      showQr: true,
      ticker: 'TRIVIA THURSDAYS · FOOD TRUCK SATURDAY',
      header: { subtitle: 'Trivia night Thursdays at 7', showClock: true, showTemp: true },
    }), [makeTap(1)]);
    expect(screen.getByText('Trivia night Thursdays at 7')).toBeInTheDocument();
    expect(screen.getByTestId('look-clock')).toBeInTheDocument();
    expect(screen.getByTestId('look-sensors')).toHaveTextContent('KEGTRON');
    expect(screen.getByTestId('look-sensors')).toHaveTextContent('34°F');
    expect(screen.getByTestId('look-ticker')).toHaveTextContent('TRIVIA THURSDAYS');
    expect(screen.getByTestId('look-qr').querySelector('svg')).toBeTruthy();
  });

  it('hides clock/sensors/ticker/QR by default and shows a quiet empty row for empty taps', () => {
    renderLook(makeConfig({ look: 'ledger' }), [makeTap(1, { beer: null, keg: null })]);
    expect(screen.queryByTestId('look-clock')).toBeNull();
    expect(screen.queryByTestId('look-sensors')).toBeNull();
    expect(screen.queryByTestId('look-ticker')).toBeNull();
    expect(screen.queryByTestId('look-qr')).toBeNull();
    expect(screen.getByTestId('ledger-row-empty')).toHaveTextContent('Tap 1 — nothing on tap');
  });

  it('marks a kicked keg KICKED and drained', () => {
    const kicked = makeTap(1);
    kicked.keg = { ...kicked.keg!, status: 'kicked' };
    renderLook(makeConfig({ look: 'ledger' }), [kicked]);
    expect(screen.getByText('KICKED')).toBeInTheDocument();
    expect(screen.getByTestId('ledger-row-remaining')).toHaveTextContent('0% left');
  });

  it('passes the configured glyph mode to the glyphs', () => {
    renderLook(makeConfig({ look: 'ledger', glyphMode: 'outline' }), [makeTap(1)]);
    expect(screen.getByTestId('srm-glass')).toHaveAttribute('data-mode', 'outline');
    expect(screen.getByTestId('hop-fill')).toHaveAttribute('data-mode', 'outline');
  });
});

describe('GalleryLook (1b)', () => {
  it('renders a card per tap with chips, the status bar, and % remaining', () => {
    renderLook(makeConfig({ look: 'gallery' }), [makeTap(1), makeTap(2), makeTap(3)]);
    expect(screen.getAllByTestId('gallery-card')).toHaveLength(3);
    const bar = screen.getAllByTestId('gallery-card-bar')[0]!;
    expect(bar.style.width).toBe('78%');
    expect(bar.className).toContain('gallery-card__bar-fill--ok');
    expect(screen.getAllByTestId('gallery-card-remaining')[0]).toHaveTextContent('78% left · ≈ 31 pints');
    expect(screen.getAllByText('6.8% ABV')).toHaveLength(3);
    expect(screen.getAllByText('204 kcal')).toHaveLength(3);
  });

  it('colors the status bar by threshold', () => {
    const low = makeTap(1);
    low.keg = { ...low.keg!, levelPct: 12, remainingMl: 19000 * 0.12 };
    renderLook(makeConfig({ look: 'gallery' }), [low]);
    expect(screen.getByTestId('gallery-card-bar').className).toContain('gallery-card__bar-fill--danger');
  });

  it('puts the QR in the header when enabled', () => {
    renderLook(makeConfig({ look: 'gallery', showQr: true }), [makeTap(1)]);
    expect(screen.getByTestId('look-qr')).toBeInTheDocument();
  });
});

describe('ColumnsLook (1c)', () => {
  it('renders a column per tap with hop/keg glyphs and % remaining', () => {
    renderLook(makeConfig({ look: 'columns' }), [makeTap(1), makeTap(2)]);
    expect(screen.getAllByTestId('columns-col')).toHaveLength(2);
    expect(screen.getAllByTestId('columns-col-remaining')[0]).toHaveTextContent('78% left');
    expect(screen.getAllByTestId('hop-fill')).toHaveLength(2);
    expect(screen.getAllByTestId('keg-silhouette')).toHaveLength(2);
  });

  it('sizes the grid to the tap count via the --look-cols variable', () => {
    renderLook(makeConfig({ look: 'columns' }), [makeTap(1), makeTap(2), makeTap(3)]);
    const grid = screen.getByTestId('columns-look').querySelector('.columns-look__grid') as HTMLElement;
    expect(grid.style.getPropertyValue('--look-cols')).toBe('3');
  });

  it('shows page-cycle dots only when there are multiple pages', () => {
    const { rerender } = renderLook(
      makeConfig({ look: 'columns' }),
      [makeTap(1)],
      { pageIndex: 0, pageCount: 2, rotationSeconds: 12 },
    );
    const dots = screen.getByTestId('columns-look-dots');
    expect(dots.querySelectorAll('.columns-look__dot')).toHaveLength(2);
    expect(dots).toHaveTextContent('PAGE 1 OF 2 — NEXT IN 12s');

    rerender(
      <WallLook
        taps={[makeTap(1)]}
        config={makeConfig({ look: 'columns' })}
        units="us"
        title="Halfmoon Brewing"
        menuUrl="http://wall.local/menu"
        tempC={null}
        pageIndex={0}
        pageCount={1}
        rotationSeconds={12}
      />,
    );
    expect(screen.queryByTestId('columns-look-dots')).toBeNull();
  });

  it('uses the short LOW badge copy', () => {
    const low = makeTap(1);
    low.keg = { ...low.keg!, levelPct: 12, remainingMl: 19000 * 0.12 };
    renderLook(makeConfig({ look: 'columns' }), [low]);
    expect(screen.getByTestId('look-badge-low')).toHaveTextContent(/^LOW$/);
  });
});
