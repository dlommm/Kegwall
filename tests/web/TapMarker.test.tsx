import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TapMarker } from '../../src/web/wall/TapMarker';
import { resolveLook } from '../../src/web/components/looks/WallLook';

const base = { beerColor: '#E0D01B', markerInk: '#141110', markerLetters: 'CH', tapNumber: 3, labelImage: null, name: 'Citra Haze' };

describe('TapMarker', () => {
  it('shows the letters and tap number in the beer color', () => {
    render(<TapMarker model={base} />);
    const m = screen.getByTestId('tap-marker');
    expect(m).toHaveTextContent('CH3');
    expect(m).toHaveAccessibleName('Tap 3: Citra Haze');
    expect(m.style.getPropertyValue('--marker-color')).toBe('#E0D01B');
  });

  it('lets uploaded label art replace the letters', () => {
    render(<TapMarker model={{ ...base, labelImage: '/labels/1.png' }} />);
    const m = screen.getByTestId('tap-marker');
    expect(m.querySelector('img')).toHaveAttribute('src', '/labels/1.png');
    expect(m).not.toHaveTextContent('CH');
  });
});

describe('resolveLook', () => {
  it('renders a built look as itself and an unbuilt one as classic', () => {
    expect(resolveLook('ledger')).toBe('ledger');
    expect(resolveLook('classic')).toBe('classic');
    expect(resolveLook(undefined)).toBe('classic');
  });
});
