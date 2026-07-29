import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SrmGlass } from '../../src/web/components/glyphs/SrmGlass';
import { HopFill } from '../../src/web/components/glyphs/HopFill';
import { AbvGlasses } from '../../src/web/components/glyphs/AbvGlasses';
import { KegSilhouette } from '../../src/web/components/glyphs/KegSilhouette';
import { glassShapeForStyle, statusToken } from '../../src/web/components/glyphs/glyphShared';
import { srmToColor } from '../../src/web/lib/srm';

describe('glassShapeForStyle — the style → glassware mapping', () => {
  it.each([
    ['Hazy IPA', 'pint'],
    ['American Pale Ale', 'pint'],
    ['Oatmeal Stout', 'nonic'],
    ['Robust Porter', 'nonic'],
    ['Saison', 'tulip'],
    ['Wild Ale', 'tulip'],
    ['Czech Pilsner', 'flute'],
    ['Helles Lager', 'flute'],
    ['Belgian Tripel', 'goblet'],
    ['Quadrupel (Quad)', 'goblet'],
    ['Amber Ale', 'mug'],
    ['Oktoberfest / Märzen', 'mug'],
  ] as const)('%s → %s', (style, shape) => {
    expect(glassShapeForStyle(style)).toBe(shape);
  });

  it('defaults to the shaker pint for unknown or missing styles', () => {
    expect(glassShapeForStyle('Kvass')).toBe('pint');
    expect(glassShapeForStyle(null)).toBe('pint');
    expect(glassShapeForStyle(undefined)).toBe('pint');
  });

  it('specific keywords win over the generic ale rule', () => {
    // "Amber Ale" contains "ale" but must hit the mug rule.
    expect(glassShapeForStyle('Amber Ale')).toBe('mug');
    // "India Pale Lager" contains both — lager beats nothing here, ipa listed later.
    expect(glassShapeForStyle('Belgian Strong Ale')).toBe('goblet');
  });
});

describe('statusToken — level → status color thresholds', () => {
  it('maps ≤15% to danger, ≤35% to warn, above to ok', () => {
    expect(statusToken(0.1)).toBe('var(--danger)');
    expect(statusToken(0.15)).toBe('var(--danger)');
    expect(statusToken(0.2)).toBe('var(--warn)');
    expect(statusToken(0.35)).toBe('var(--warn)');
    expect(statusToken(0.36)).toBe('var(--ok)');
    expect(statusToken(1)).toBe('var(--ok)');
  });
});

describe('SrmGlass', () => {
  it('auto-selects the shape from the beer style and tints the liquid with the SRM color', () => {
    render(<SrmGlass srm={38} style="Oatmeal Stout" width={58} />);
    const svg = screen.getByTestId('srm-glass');
    expect(svg).toHaveAttribute('data-shape', 'nonic');
    const liquid = screen.getByTestId('srm-glass-liquid');
    expect(liquid).toHaveAttribute('fill', srmToColor(38).liquid);
  });

  it('an explicit shape override beats the style mapping', () => {
    render(<SrmGlass srm={5} style="Oatmeal Stout" shape="tulip" width={58} />);
    expect(screen.getByTestId('srm-glass')).toHaveAttribute('data-shape', 'tulip');
  });

  it('outline mode drops the body fill and marks the mode', () => {
    const { container } = render(<SrmGlass srm={5} style="IPA" width={58} mode="outline" />);
    expect(screen.getByTestId('srm-glass')).toHaveAttribute('data-mode', 'outline');
    // No body-fill path in outline mode: every direct-child <path> of the svg
    // is the stroke outline (fill="none"); the only filled path lives inside
    // the <defs> clip definition.
    const bodyPaths = [...container.querySelectorAll('svg > path')]
      .filter((p) => p.getAttribute('fill') !== 'none');
    expect(bodyPaths).toHaveLength(0);
  });

  it('duotone mode tints the glass body with the beer color', () => {
    const { container } = render(<SrmGlass srm={14} style="IPA" width={58} mode="duotone" />);
    const body = [...container.querySelectorAll('path')]
      .find((p) => p.getAttribute('fill-opacity') === '0.18');
    expect(body?.getAttribute('fill')).toBe(srmToColor(14).liquid);
  });

  it('fill fraction positions the liquid surface (full vs. near-empty)', () => {
    const { rerender } = render(<SrmGlass srm={5} style="IPA" width={58} fill={1} />);
    const fullY = Number(screen.getByTestId('srm-glass-liquid').getAttribute('y'));
    rerender(<SrmGlass srm={5} style="IPA" width={58} fill={0.1} />);
    const emptyY = Number(screen.getByTestId('srm-glass-liquid').getAttribute('y'));
    expect(fullY).toBeLessThan(emptyY);
  });

  it('height follows the 60:80 viewBox ratio', () => {
    render(<SrmGlass srm={5} style="IPA" width={60} />);
    expect(screen.getByTestId('srm-glass')).toHaveAttribute('height', '80');
  });
});

describe('HopFill', () => {
  it('fills proportionally to IBU over the cap', () => {
    const { rerender } = render(<HopFill ibu={50} cap={100} width={50} />);
    const halfY = Number(screen.getByTestId('hop-fill-liquid').getAttribute('y'));
    rerender(<HopFill ibu={100} cap={100} width={50} />);
    const fullY = Number(screen.getByTestId('hop-fill-liquid').getAttribute('y'));
    expect(fullY).toBeLessThan(halfY);
    // Full cone: liquid starts at the cone's top (y = 8).
    expect(fullY).toBe(8);
  });

  it('clamps IBU beyond the cap and renders empty for null IBU', () => {
    const { rerender } = render(<HopFill ibu={200} cap={60} width={50} />);
    expect(Number(screen.getByTestId('hop-fill-liquid').getAttribute('y'))).toBe(8);
    rerender(<HopFill ibu={null} width={50} />);
    // Empty: surface sits at the cone bottom (8 + 65).
    expect(Number(screen.getByTestId('hop-fill-liquid').getAttribute('y'))).toBe(73);
  });
});

describe('AbvGlasses', () => {
  it('renders one mini glass per 5% ABV, fractional last (9.1% → 2 glasses)', () => {
    render(<AbvGlasses abv={9.1} srm={6} />);
    expect(screen.getByTestId('abv-glasses')).toHaveAttribute('data-count', '2');
  });

  it('a 4.9% beer renders a single glass', () => {
    render(<AbvGlasses abv={4.9} srm={3} />);
    expect(screen.getByTestId('abv-glasses')).toHaveAttribute('data-count', '1');
  });

  it('a 12% beer renders three glasses', () => {
    render(<AbvGlasses abv={12} srm={20} />);
    expect(screen.getByTestId('abv-glasses')).toHaveAttribute('data-count', '3');
  });

  it('renders nothing without an ABV', () => {
    const { container } = render(<AbvGlasses abv={null} srm={6} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('KegSilhouette', () => {
  it('fills to the level % and colors by status threshold', () => {
    const { rerender } = render(<KegSilhouette levelPct={78} width={62} />);
    let level = screen.getByTestId('keg-silhouette-level');
    expect(level.getAttribute('fill')).toBe('var(--ok)');
    rerender(<KegSilhouette levelPct={20} width={62} />);
    level = screen.getByTestId('keg-silhouette-level');
    expect(level.getAttribute('fill')).toBe('var(--warn)');
    rerender(<KegSilhouette levelPct={10} width={62} />);
    level = screen.getByTestId('keg-silhouette-level');
    expect(level.getAttribute('fill')).toBe('var(--danger)');
  });

  it('level height scales with the percentage', () => {
    const { rerender } = render(<KegSilhouette levelPct={100} width={62} />);
    const fullH = Number(screen.getByTestId('keg-silhouette-level').getAttribute('height'));
    rerender(<KegSilhouette levelPct={50} width={62} />);
    const halfH = Number(screen.getByTestId('keg-silhouette-level').getAttribute('height'));
    expect(halfH).toBeCloseTo(fullH / 2, 5);
  });

  it('narrows the body for slim keg types', () => {
    const { container: corny } = render(<KegSilhouette levelPct={50} kegType="cornelius" width={62} />);
    const { container: half } = render(<KegSilhouette levelPct={50} kegType="half-barrel" width={62} />);
    const bodyWidth = (c: HTMLElement) => Number(
      [...c.querySelectorAll('rect')].find((r) => r.getAttribute('rx') === '6' && r.getAttribute('fill') === 'rgba(127,127,127,0.08)')?.getAttribute('width'),
    );
    expect(bodyWidth(corny as unknown as HTMLElement)).toBeLessThan(bodyWidth(half as unknown as HTMLElement));
  });
});
