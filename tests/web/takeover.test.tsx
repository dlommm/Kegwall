import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PourTakeover } from '../../src/web/components/takeover/PourTakeover';
import { pourFraction, splitVolume, REFERENCE_POUR_ML } from '../../src/web/components/takeover/takeoverShared';
import type { TakeoverState } from '../../src/web/lib/useTakeover';
import type { TapState } from '../../src/server/core/state';
import { srmToColor } from '../../src/web/lib/srm';

vi.mock('../../src/web/lib/usePrefersReducedMotion', () => ({
  usePrefersReducedMotion: () => false,
}));

function makeTap(overrides: Partial<TapState> = {}): TapState {
  return {
    tapId: 2,
    tapNumber: 2,
    tapName: null,
    beer: {
      id: 2,
      name: 'Morning Line',
      brewery: 'Halfmoon Brewing',
      style: 'Czech Pilsner',
      abv: 4.9,
      ibu: 32,
      srm: 3,
      description: null,
      labelImage: null,
      createdAt: '',
    },
    keg: {
      id: 2,
      beerId: 2,
      tapId: 2,
      sizeMl: 58670,
      volStartMl: 58670,
      volDispensedMl: 58670 * 0.59,
      dateTapped: null,
      status: 'on_tap',
      createdAt: '',
      kegType: 'half-barrel',
      levelPct: 41,
      remainingMl: 58670 * 0.41,
    },
    lastPour: null,
    pouring: true,
    curServMl: 250,
    monitorOnline: true,
    temp: 1.1,
    ...overrides,
  };
}

function activeState(pourMl = 250): Extract<TakeoverState, { phase: 'active' }> {
  return { phase: 'active', tap: makeTap({ curServMl: pourMl }), pourMl };
}

function completeState(pourMl = 372.6): Extract<TakeoverState, { phase: 'complete' }> {
  return { phase: 'complete', tap: makeTap({ pouring: false, curServMl: null }), pourMl };
}

describe('takeoverShared', () => {
  it('splitVolume formats per unit system', () => {
    expect(splitVolume(372.6, 'us')).toEqual({ value: '12.6', unit: 'OZ' });
    expect(splitVolume(372.6, 'metric')).toEqual({ value: '373', unit: 'ML' });
  });

  it('pourFraction normalizes against a pint and caps at 1', () => {
    expect(pourFraction(0)).toBe(0);
    expect(pourFraction(REFERENCE_POUR_ML / 2)).toBeCloseTo(0.5, 5);
    expect(pourFraction(REFERENCE_POUR_ML * 3)).toBe(1);
  });
});

describe('PourTakeover dispatch', () => {
  it.each([
    ['full', 'takeover-full'],
    ['split', 'takeover-split'],
    ['dock', 'takeover-dock'],
    ['fill', 'takeover-fill'],
  ] as const)('renders the %s view', (style, testId) => {
    render(<PourTakeover style={style} state={activeState()} units="us" tempC={1.1} />);
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  });

  it('renders nothing for spotlight/off (handled by the wall itself)', () => {
    const { container } = render(
      <PourTakeover style="spotlight" state={activeState()} units="us" tempC={null} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe('FullTakeover (2a)', () => {
  it('shows the beer identity, chips, live counter, keg remaining and pour stream', () => {
    render(<PourTakeover style="full" state={activeState(250)} units="us" tempC={1.1} />);
    expect(screen.getByTestId('takeover-beer-name')).toHaveTextContent('Morning Line');
    expect(screen.getByText('NOW POURING · TAP 2')).toBeInTheDocument();
    expect(screen.getByText('4.9% ABV')).toBeInTheDocument();
    expect(screen.getByText('32 IBU')).toBeInTheDocument();
    expect(screen.getByText('147 kcal / 12 oz')).toBeInTheDocument();
    expect(screen.getByText('Kegtron 34°F')).toBeInTheDocument();
    expect(screen.getByTestId('takeover-counter')).toHaveTextContent('8.5');
    expect(screen.getByText(/left in keg/)).toBeInTheDocument();
    expect(screen.getByTestId('takeover-stream')).toBeInTheDocument();
    expect(screen.getByTestId('srm-glass')).toBeInTheDocument();
    expect(screen.queryByTestId('takeover-complete')).toBeNull();
  });

  it('shows the complete splash with the final volume and drops the stream', () => {
    render(<PourTakeover style="full" state={completeState(372.6)} units="us" tempC={null} />);
    const complete = screen.getByTestId('takeover-complete');
    expect(complete).toHaveTextContent('POUR COMPLETE');
    expect(complete).toHaveTextContent('12.6 OZ');
    expect(complete).toHaveTextContent('claim this pour');
    expect(screen.queryByTestId('takeover-stream')).toBeNull();
  });
});

describe('SplitTakeover (9a)', () => {
  it('shows the counter and a progress hairline sized to the pour fraction', () => {
    render(<PourTakeover style="split" state={activeState(236.6)} units="us" tempC={null} />);
    expect(screen.getByTestId('takeover-counter')).toHaveTextContent('8.0');
    const fill = document.querySelector('.takeover-split__progress-fill') as HTMLElement;
    expect(fill.style.width).toBe('50%');
    expect(screen.getByTestId('takeover-active-note')).toHaveTextContent('panel closes when the tap shuts');
  });

  it('swaps the note for a cheers line on complete', () => {
    render(<PourTakeover style="split" state={completeState()} units="us" tempC={null} />);
    expect(screen.getByTestId('takeover-complete')).toHaveTextContent('cheers');
  });
});

describe('DockTakeover (9b)', () => {
  it('shows tap + beer, progress and counter; COMPLETE chip only at the end', () => {
    const { rerender } = render(
      <PourTakeover style="dock" state={activeState(250)} units="us" tempC={null} />,
    );
    expect(screen.getByTestId('takeover-beer-name')).toHaveTextContent('Tap 2 · Morning Line');
    expect(screen.getByTestId('takeover-counter')).toHaveTextContent('8.5 OZ');
    expect(screen.queryByTestId('takeover-complete')).toBeNull();

    rerender(<PourTakeover style="dock" state={completeState()} units="us" tempC={null} />);
    expect(screen.getByTestId('takeover-complete')).toHaveTextContent('COMPLETE ✓');
  });
});

describe('FillTakeover (9c)', () => {
  it("renders the rising liquid in the beer's real SRM with the foam band tracking it", () => {
    render(<PourTakeover style="fill" state={activeState(236.6)} units="us" tempC={1.1} />);
    const liquid = screen.getByTestId('takeover-fill-liquid');
    expect(liquid.style.height).toBe('50%');
    // jsdom normalizes inline hex colors to rgb() — compare in that space.
    const srmHex = srmToColor(3).liquid;
    const expectedRgb = `rgb(${parseInt(srmHex.slice(1, 3), 16)}, ${parseInt(srmHex.slice(3, 5), 16)}, ${parseInt(srmHex.slice(5, 7), 16)})`;
    expect(liquid.style.background).toBe(expectedRgb);
    expect(screen.getByTestId('takeover-counter')).toHaveTextContent('8.0');
    expect(screen.getByText(/Czech Pilsner · 4.9% · 34°F/)).toBeInTheDocument();
  });

  it('shows the cheers line on complete', () => {
    render(<PourTakeover style="fill" state={completeState()} units="us" tempC={null} />);
    expect(screen.getByTestId('takeover-complete')).toHaveTextContent('CHEERS — BACK TO THE WALL');
  });
});
