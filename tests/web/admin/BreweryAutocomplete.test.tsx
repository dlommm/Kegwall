import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { useState } from 'react';
import {
  act, fireEvent, render, screen,
} from '@testing-library/react';
import { BreweryAutocomplete } from '../../../src/web/routes/admin/BreweryAutocomplete';
import { lookupBreweries } from '../../../src/web/lib/adminApi';

vi.mock('../../../src/web/lib/adminApi', () => ({ lookupBreweries: vi.fn() }));

function Harness() {
  const [value, setValue] = useState('');
  return <BreweryAutocomplete value={value} onChange={setValue} />;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (lookupBreweries as Mock).mockResolvedValue({ ok: true, data: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('BreweryAutocomplete', () => {
  it('does not call the lookup for a query under 2 characters', async () => {
    vi.useFakeTimers();
    render(<Harness />);
    fireEvent.change(screen.getByTestId('brewery-input'), { target: { value: 'M' } });
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(lookupBreweries).not.toHaveBeenCalled();
  });

  it('waits 300ms after typing stops before calling the lookup', async () => {
    vi.useFakeTimers();
    render(<Harness />);
    fireEvent.change(screen.getByTestId('brewery-input'), { target: { value: 'Mo' } });
    await act(async () => { vi.advanceTimersByTime(299); });
    expect(lookupBreweries).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(lookupBreweries).toHaveBeenCalledTimes(1);
    expect(lookupBreweries).toHaveBeenCalledWith('Mo');
  });

  it('resets the debounce timer on further keystrokes, firing once for the final value', async () => {
    vi.useFakeTimers();
    render(<Harness />);
    const input = screen.getByTestId('brewery-input');
    fireEvent.change(input, { target: { value: 'Mo' } });
    await act(async () => { vi.advanceTimersByTime(200); });
    fireEvent.change(input, { target: { value: 'Mod' } });
    await act(async () => { vi.advanceTimersByTime(299); });
    expect(lookupBreweries).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(lookupBreweries).toHaveBeenCalledTimes(1);
    expect(lookupBreweries).toHaveBeenCalledWith('Mod');
  });

  it('renders suggestions (name + city/state) and selecting one fills the input and closes the list', async () => {
    vi.useFakeTimers();
    (lookupBreweries as Mock).mockResolvedValue({
      ok: true, data: [{ name: 'Modern Brew Co', city: 'Portland', state: 'Oregon' }],
    });
    render(<Harness />);
    const input = screen.getByTestId('brewery-input');
    fireEvent.change(input, { target: { value: 'Modern' } });
    fireEvent.focus(input);
    await act(async () => { vi.advanceTimersByTime(300); });
    await flush();

    const option = screen.getByTestId('brewery-suggestion');
    expect(option).toHaveTextContent('Modern Brew Co');
    expect(option).toHaveTextContent('Portland, Oregon');

    fireEvent.mouseDown(option);
    fireEvent.click(option);
    expect(input).toHaveValue('Modern Brew Co');
    expect(screen.queryByTestId('brewery-suggestions')).not.toBeInTheDocument();
  });

  it('shows no suggestions when the lookup fails', async () => {
    vi.useFakeTimers();
    (lookupBreweries as Mock).mockResolvedValue({ ok: false, status: 502, message: 'x' });
    render(<Harness />);
    const input = screen.getByTestId('brewery-input');
    fireEvent.change(input, { target: { value: 'Modern' } });
    fireEvent.focus(input);
    await act(async () => { vi.advanceTimersByTime(300); });
    await flush();
    expect(screen.queryByTestId('brewery-suggestions')).not.toBeInTheDocument();
  });
});
