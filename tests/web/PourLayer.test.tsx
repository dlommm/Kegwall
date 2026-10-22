import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { TapState } from '../../src/server/core/state.js';
import { PourLayer, MAX_LANES } from '../../src/web/wall/pour/PourLayer';
import {
  glassFraction, headFraction, laneVolumeMl, servingMarks, volumeParts,
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
});
