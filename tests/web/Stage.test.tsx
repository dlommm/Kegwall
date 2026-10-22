import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Stage } from '../../src/web/design/Stage';

describe('Stage (Kegwall V2 wall stage)', () => {
  it('fills the screen by default and carries the wall surface hook', () => {
    render(<Stage><p>tap list</p></Stage>);
    const outer = screen.getByTestId('stage-screen');
    const stage = outer.firstElementChild as HTMLElement;
    expect(stage.dataset.surface).toBe('wall');
    expect(stage).toHaveTextContent('tap list');
    expect(stage.style.transform).toBe('');
  });

  it('passes the wall UI scale through as --ui-scale', () => {
    render(<Stage uiScale={1.25}><p>x</p></Stage>);
    const stage = screen.getByTestId('stage-screen').firstElementChild as HTMLElement;
    expect(stage.style.getPropertyValue('--ui-scale')).toBe('1.25');
  });

  it('scales a fixed 1920 × 1080 stage down in fit mode (the editor preview)', () => {
    render(<Stage mode="fit" surface="preview"><p>x</p></Stage>);
    const stage = screen.getByTestId('stage-fit').firstElementChild as HTMLElement;
    expect(stage.dataset.surface).toBe('preview');
    expect(stage.style.transform).toMatch(/^scale\(/);
  });
});
