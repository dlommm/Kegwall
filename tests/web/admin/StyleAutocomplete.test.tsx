import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { StyleAutocomplete } from '../../../src/web/routes/admin/StyleAutocomplete';

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <StyleAutocomplete value={value} onChange={setValue} />;
}

describe('StyleAutocomplete', () => {
  it('does not show suggestions for a query under 2 characters', () => {
    render(<Harness />);
    fireEvent.change(screen.getByTestId('style-input'), { target: { value: 'I' } });
    expect(screen.queryByTestId('style-suggestions')).not.toBeInTheDocument();
  });

  it('filters synchronously (no debounce/network) by case-insensitive substring, capped at 8', () => {
    render(<Harness />);
    const input = screen.getByTestId('style-input');
    fireEvent.change(input, { target: { value: 'ale' } });
    fireEvent.focus(input);
    // No fake timers, no act(async...) wait — suggestions must already be present.
    const options = screen.getAllByTestId('style-suggestion');
    expect(options.length).toBeGreaterThan(0);
    expect(options.length).toBeLessThanOrEqual(8);
    for (const option of options) {
      expect(option.textContent!.toLowerCase()).toContain('ale');
    }
  });

  it('matches case-insensitively regardless of the case typed', () => {
    render(<Harness />);
    const input = screen.getByTestId('style-input');
    fireEvent.change(input, { target: { value: 'HAZY' } });
    fireEvent.focus(input);
    const options = screen.getAllByTestId('style-suggestion');
    expect(options.map((o) => o.textContent)).toContain('Hazy IPA');
  });

  it('selecting a suggestion fills the input and closes the list', () => {
    render(<Harness />);
    const input = screen.getByTestId('style-input');
    fireEvent.change(input, { target: { value: 'Irish Sto' } });
    fireEvent.focus(input);
    const option = screen.getByText('Irish Stout');
    fireEvent.mouseDown(option);
    fireEvent.click(option);
    expect(input).toHaveValue('Irish Stout');
    expect(screen.queryByTestId('style-suggestions')).not.toBeInTheDocument();
  });

  it('allows free text not present in the BJCP list — never blocks or overwrites it', () => {
    render(<Harness />);
    const input = screen.getByTestId('style-input');
    fireEvent.change(input, { target: { value: 'My House Blend Ale' } });
    fireEvent.focus(input);
    expect(input).toHaveValue('My House Blend Ale');
    // Free text may still surface a partial match (contains "Ale") -- selecting is
    // optional, never forced. The point under test is that the typed value itself is
    // preserved verbatim and nothing throws/blocks on an unrecognized style.
    fireEvent.blur(input);
    expect(input).toHaveValue('My House Blend Ale');
  });

  it('shows no suggestion list when nothing matches', () => {
    render(<Harness />);
    const input = screen.getByTestId('style-input');
    fireEvent.change(input, { target: { value: 'zzzznotastyle' } });
    fireEvent.focus(input);
    expect(screen.queryByTestId('style-suggestions')).not.toBeInTheDocument();
  });

  it('opens the list on focus (same convention as BreweryAutocomplete) when the value already qualifies', () => {
    render(<Harness initial="Irish" />);
    const input = screen.getByTestId('style-input');
    expect(screen.queryByTestId('style-suggestions')).not.toBeInTheDocument();
    fireEvent.focus(input);
    expect(screen.getByTestId('style-suggestions')).toBeInTheDocument();
  });

  it('closes the list on a genuine blur without selecting anything', () => {
    render(<Harness />);
    const input = screen.getByTestId('style-input');
    fireEvent.change(input, { target: { value: 'Stout' } });
    fireEvent.focus(input);
    expect(screen.getByTestId('style-suggestions')).toBeInTheDocument();
    fireEvent.blur(input);
    expect(screen.queryByTestId('style-suggestions')).not.toBeInTheDocument();
    expect(input).toHaveValue('Stout');
  });

  it('a suggestion button preventDefaults its mousedown so it survives the blur it triggers', () => {
    render(<Harness />);
    const input = screen.getByTestId('style-input');
    fireEvent.change(input, { target: { value: 'Stout' } });
    fireEvent.focus(input);
    const option = screen.getAllByTestId('style-suggestion')[0]!;
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    const prevented = !option.dispatchEvent(event);
    expect(prevented).toBe(true);
  });

  it('sets role=combobox and aria-expanded reflecting the suggestion list state', () => {
    render(<Harness />);
    const input = screen.getByTestId('style-input');
    expect(input).toHaveAttribute('role', 'combobox');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    fireEvent.change(input, { target: { value: 'Stout' } });
    fireEvent.focus(input);
    expect(input).toHaveAttribute('aria-expanded', 'true');
  });
});
