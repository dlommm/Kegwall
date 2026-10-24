import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { TapState } from '../../src/server/core/state.js';
import { PourLayer, MAX_LANES } from '../../src/web/wall/pour/PourLayer';
import {
  brimmed, glassFraction, headFraction, laneVolumeMl, servingMarks, volumeParts,
} from '../../src/web/wall/pour/pourKit';
import type { PourLane } from '../../src/web/wall/pour/usePourLanes';

vi.mock('../../src/web/lib/usePrefersReducedMotion', () => ({ usePrefersReducedMotion: () => true }));

function lane(tapId: number, over: Partial<PourLane> = {}): PourLane {
  const tap = {
    tapId, tapNumber: tapId, tapName: null,
    beer: { id: tapId, name: `Beer ${tapId}`, brewery: null, style: 'IPA', abv: 6, ibu: 40, srm: 6, description: null, labelImage: null, createdAt: '' },
    keg: null, lastPour: null, pouring: true, curServMl: 236, monitorOnline: true, hidden: false, temp: null,
    avgRating: null, nextUpBeerName: null, tonight: { pours: 0, volumeMl: 0 }, lastHourPours: 0, kickDate: null,
  } as TapState;
  return {
    key: `${tapId}`, tapId, tap, phase: 'pouring', measuredMl: 236, recordedMl: null, durationMs: null,
    pourerName: null, pourerPourCount: null, startedAt: 0, ...over,
  };
}

describe('pour kit', () => {
  it('splits a volume into number and unit', () => {
    expect(volumeParts(236.6, 'us')).toEqual({ value: '8.0', unit: 'oz' });
    expect(volumeParts(236.6, 'metric')).toEqual({ value: '237', unit: 'mL' });
  });

  it('shows the recorded volume once a lane finishes, the live reading before', () => {
    expect(laneVolumeMl(lane(1))).toBe(236);
    expect(laneVolumeMl(lane(1, { phase: 'finish', recordedMl: 412 }))).toBe(412);
    expect(laneVolumeMl(lane(1, { phase: 'finish', recordedMl: null }))).toBe(236);
  });

  it('fills the glass by measured volume over one serving, capped full; the head forms past half', () => {
    expect(glassFraction(236.5, 473)).toBeCloseTo(0.5, 2);
    expect(glassFraction(600, 473)).toBe(1);
    expect(headFraction(0.5)).toBe(0);
    expect(headFraction(1)).toBeCloseTo(1, 5);
  });

  it('caps and spills the head only on a finished, full glass', () => {
    expect(brimmed(412 / 473, true)).toBe(true);
    expect(brimmed(412 / 473, false)).toBe(false);
    expect(brimmed(120 / 473, true)).toBe(false);
  });

  it('marks 8, 12 and 16 oz on a pint glass', () => {
    expect(servingMarks(473, 'us').map((m) => m.label)).toEqual(['8 oz', '12 oz', '16 oz']);
  });
});

describe('PourLayer', () => {
  it('draws one lane per pour for an overlay style', () => {
    render(<PourLayer style="full" lanes={[lane(1), lane(6)]} units="us" servingSizeMl={473} />);
    expect(screen.getByTestId('takeover-full')).toHaveAttribute('data-lanes', '2');
    expect(screen.getAllByTestId('pour-lane')).toHaveLength(2);
  });

  it('finishes on the recorded volume and thanks the pourer', () => {
    render(<PourLayer style="full" lanes={[lane(1, { phase: 'finish', recordedMl: 412, durationMs: 6100, pourerName: 'Alex Rivera' })]} units="us" servingSizeMl={473} />);
    const l = screen.getByTestId('pour-lane');
    expect(screen.getByTestId('pour-volume')).toHaveTextContent('13.9oz');
    expect(l).toHaveTextContent('Cheers, Alex');
    expect(l).toHaveTextContent('Recorded 13.9 oz · 412 mL in 6.1 s');
  });

  it('caps the lanes and summarizes the rest', () => {
    const lanes = Array.from({ length: MAX_LANES + 2 }, (_, i) => lane(i + 1));
    render(<PourLayer style="dock" lanes={lanes} units="us" servingSizeMl={473} />);
    expect(screen.getAllByTestId('pour-lane')).toHaveLength(MAX_LANES);
    expect(screen.getByTestId('takeover-dock')).toHaveTextContent('+2 more pouring');
  });

  it.each(['spotlight', 'off'] as const)('draws nothing for %s (the look itself shows the pour)', (style) => {
    const { container } = render(<PourLayer style={style} lanes={[lane(1)]} units="us" servingSizeMl={473} />);
    expect(container.firstChild).toBeNull();
  });

  it.each(['split', 'fill'] as const)('draws the %s style', (style) => {
    render(<PourLayer style={style} lanes={[lane(1)]} units="us" servingSizeMl={473} />);
    expect(screen.getByTestId(`takeover-${style}`)).toHaveTextContent('Beer 1');
  });

  it('Tap Pull pulls the handle while pouring', () => {
    render(<PourLayer style="tappull" lanes={[lane(1)]} units="us" servingSizeMl={473} />);
    expect(screen.getByTestId('takeover-tappull').querySelector('[data-pulled="true"]')).not.toBeNull();
  });

  it('Keg Drain counts pints left down to two decimals', () => {
    const l = lane(1);
    l.tap = { ...l.tap, keg: { id: 1, beerId: 1, tapId: 1, sizeMl: 19000, volStartMl: 19000, volDispensedMl: 9500, dateTapped: null, status: 'on_tap', createdAt: '', kegType: null, costCents: null, levelPct: 50, remainingMl: 9500 } as never };
    render(<PourLayer style="kegdrain" lanes={[l]} units="us" servingSizeMl={473} />);
    expect(screen.getByTestId('takeover-kegdrain')).toHaveTextContent(((9500 - 236) / 473).toFixed(2));
  });

  it('several pours on Keg Drain fall back to lanes', () => {
    render(<PourLayer style="kegdrain" lanes={[lane(1), lane(2)]} units="us" servingSizeMl={473} />);
    expect(screen.getByTestId('takeover-full')).toBeInTheDocument();
  });

  it('finishes a single full-screen pour with Cheers and the passport stamp', () => {
    render(<PourLayer style="full" finish="cheers" lanes={[lane(1, { phase: 'finish', recordedMl: 412, pourerName: 'Alex Rivera', pourerPourCount: 15 })]} units="us" servingSizeMl={473} />);
    expect(screen.getByTestId('pour-cheers')).toHaveTextContent('Cheers, Alex');
    expect(screen.getByTestId('pour-cheers')).toHaveTextContent('Passport · pour 15');
  });
});
