import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import {
  Chips, ConfirmDialog, Field, Tabs, StatusDot, Switch, barColor, type RunState,
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

  it('marks the one applied filter chip as pressed', () => {
    const onChange = vi.fn();
    render(
      <Chips
        label="Show taps"
        value="all"
        onChange={onChange}
        options={[{ value: 'all', label: 'All', count: 12 }, { value: 'swap', label: 'Needs a swap', count: 3 }]}
      />,
    );
    expect(screen.getByRole('button', { name: 'All 12' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Needs a swap 3' }));
    expect(onChange).toHaveBeenCalledWith('swap');
  });

  it('moves between tabs with the arrow keys and selects the focused one', () => {
    const onChange = vi.fn();
    render(
      <Tabs
        label="People sections"
        idBase="t"
        value="a"
        onChange={onChange}
        items={[{ value: 'a', label: 'Pourers' }, { value: 'b', label: 'Accounts' }]}
      />,
    );
    const first = screen.getByRole('tab', { name: 'Pourers' });
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Accounts' })).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('b');
    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('b');
  });

  it("won't close a confirm while its action is running", () => {
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog open onOpenChange={onOpenChange} title="Delete tap 3?" confirmLabel="Delete" busy onConfirm={vi.fn()}>
        <p>This permanently deletes tap 3.</p>
      </ConfirmDialog>,
    );
    expect(screen.getByRole('alertdialog', { name: 'Delete tap 3?' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('lifts a stout’s near-black so its level bar still reads on the dark track', () => {
    expect(barColor('#0a0503')).not.toBe('#0a0503');
    expect(barColor('#E0B266')).toBe('#E0B266');
    expect(barColor('var(--surface)')).toBe('var(--surface)');
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
