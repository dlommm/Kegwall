import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import {
  Field, StatusDot, Switch, type RunState,
} from '../../../src/web/routes/admin/ui';
import { filterEntries, paletteEntries } from '../../../src/web/routes/admin/CommandPalette';
import { visibleDestinations } from '../../../src/web/routes/admin/adminNav';
import { ADMIN_LOOK_LIGHT, useAdminLook } from '../../../src/web/routes/admin/adminLook';

describe('admin primitives (Kegwall V2)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('gives each of the six run states its own shape and a word, not color alone', () => {
    const states: RunState[] = ['enabled', 'disabled', 'pending', 'executing', 'completed', 'failed'];
    const { container } = render(<>{states.map((s) => <StatusDot key={s} state={s} />)}</>);
    const shapes = [...container.querySelectorAll('svg')].map((svg) => svg.innerHTML);
    expect(new Set(shapes).size).toBe(6);
    expect(container).toHaveTextContent('OnOffWaitingRunningDoneFailed');
  });

  it('keeps an icon-only state readable by screen readers', () => {
    render(<StatusDot state="failed" label="Failed at 6:12 PM" iconOnly />);
    expect(screen.getByText('Failed at 6:12 PM')).toHaveClass('adm-sr-only');
  });

  it('toggles a switch and reports it as a switch', () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onChange} label="Prices on the wall" />);
    const sw = screen.getByRole('switch', { name: 'Prices on the wall' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('ties a field\'s help and error to its input', () => {
    render(<Field label="Serving size" help="In ounces" error="Must be above zero" />);
    const input = screen.getByLabelText('Serving size');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('In ounces Must be above zero');
  });

  it('builds palette entries per sub-tab and ranks label-prefix matches first', () => {
    const entries = paletteEntries(visibleDestinations('admin'));
    expect(entries.find((e) => e.to === '/admin/kegs')).toMatchObject({ label: 'Kegs', hint: 'Taps & kegs' });
    expect(entries.find((e) => e.to === '/admin')).toMatchObject({ label: 'Tonight' });
    const hits = filterEntries(entries, 'ke');
    expect(hits[0]!.label).toBe('Kegs');
    expect(hits.map((e) => e.label)).toContain('Taps');
    expect(filterEntries(entries, 'screens').map((e) => e.label)).toEqual(['Walls', 'Displays', 'Presence', 'Games']);
  });

  it('follows the device color scheme, dark by default', () => {
    expect(renderHook(() => useAdminLook()).result.current.scheme).toBe('dark');
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('light'), addEventListener: () => {}, removeEventListener: () => {},
    }));
    const { result } = renderHook(() => useAdminLook());
    expect(result.current.scheme).toBe('light');
    expect(result.current.theme).toBe(ADMIN_LOOK_LIGHT);
  });
});
