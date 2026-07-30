import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { TapForm } from '../../../src/web/routes/admin/TapForm';
import { createTap, updateTap } from '../../../src/web/lib/adminApi';
import { getDrinkers } from '../../../src/web/lib/api';
import type { Tap } from '../../../src/server/db/taps';

vi.mock('../../../src/web/lib/adminApi', () => ({
  createTap: vi.fn(),
  updateTap: vi.fn(),
}));

vi.mock('../../../src/web/lib/api', () => ({
  getDrinkers: vi.fn(),
}));

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('TapForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getDrinkers as Mock).mockResolvedValue({
      ok: true,
      data: [
        { id: 1, displayName: 'Bob', avatarColor: null },
        { id: 2, displayName: 'Sam', avatarColor: null },
      ],
    });
  });

  it('requires a tap number before submitting', async () => {
    render(<TapForm mode="create" tap={null} onSaved={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByTestId('tap-form-submit'));
    await flush();
    expect(screen.getByTestId('tap-form-validation-error')).toHaveTextContent('Tap number is required.');
    expect(createTap).not.toHaveBeenCalled();
  });

  it('rejects a non-integer or zero/negative tap number', async () => {
    render(<TapForm mode="create" tap={null} onSaved={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByTestId('tap-form-number'), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('tap-form-submit'));
    await flush();
    expect(screen.getByTestId('tap-form-validation-error')).toHaveTextContent('whole number of 1 or more');
    expect(createTap).not.toHaveBeenCalled();
  });

  it('submits a valid create form with a null name and no default drinker when blank', async () => {
    const created: Tap = {
      id: 1, number: 3, name: null, defaultDrinkerId: null, hidden: false,
    };
    (createTap as Mock).mockResolvedValue({ ok: true, data: created });
    const onSaved = vi.fn();
    render(<TapForm mode="create" tap={null} onSaved={onSaved} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByTestId('tap-form-number'), { target: { value: '3' } });
    fireEvent.click(screen.getByTestId('tap-form-submit'));
    await flush();
    expect(createTap).toHaveBeenCalledWith({ number: 3, name: null, defaultDrinkerId: null, hidden: false });
    expect(onSaved).toHaveBeenCalledWith(created);
  });

  it('checking "Hide from wall & menu" sends hidden: true, and an already-hidden tap pre-checks it', async () => {
    (createTap as Mock).mockResolvedValue({
      ok: true, data: { id: 2, number: 4, name: null, defaultDrinkerId: null, hidden: true },
    });
    render(<TapForm mode="create" tap={null} onSaved={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByTestId('tap-form-number'), { target: { value: '4' } });
    fireEvent.click(screen.getByTestId('tap-form-hidden'));
    fireEvent.click(screen.getByTestId('tap-form-submit'));
    await flush();
    expect(createTap).toHaveBeenCalledWith({ number: 4, name: null, defaultDrinkerId: null, hidden: true });

    render(
      <TapForm
        mode="edit"
        tap={{ id: 2, number: 4, name: null, defaultDrinkerId: null, hidden: true }}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const boxes = screen.getAllByTestId('tap-form-hidden');
    expect(boxes[boxes.length - 1]).toBeChecked();
  });

  it('pre-fills from the given tap in edit mode and PATCHes on submit', async () => {
    const tap: Tap = {
      id: 5, number: 2, name: 'Left', defaultDrinkerId: null, hidden: false,
    };
    (updateTap as Mock).mockResolvedValue({ ok: true, data: tap });
    const onSaved = vi.fn();
    render(<TapForm mode="edit" tap={tap} onSaved={onSaved} onCancel={vi.fn()} />);
    expect(screen.getByTestId('tap-form-number')).toHaveValue('2');
    expect(screen.getByTestId('tap-form-name')).toHaveValue('Left');
    fireEvent.change(screen.getByTestId('tap-form-name'), { target: { value: 'Right' } });
    fireEvent.click(screen.getByTestId('tap-form-submit'));
    await flush();
    expect(updateTap).toHaveBeenCalledWith(5, { number: 2, name: 'Right', defaultDrinkerId: null, hidden: false });
    expect(onSaved).toHaveBeenCalledWith(tap);
  });

  it('pre-fills the default-drinker picker from the given tap in edit mode, and submits a changed selection', async () => {
    const tap: Tap = {
      id: 5, number: 2, name: 'Left', defaultDrinkerId: 1, hidden: false,
    };
    (updateTap as Mock).mockResolvedValue({ ok: true, data: tap });
    render(<TapForm mode="edit" tap={tap} onSaved={vi.fn()} onCancel={vi.fn()} />);
    await flush();
    expect(screen.getByTestId('tap-form-default-drinker')).toHaveValue('1');

    fireEvent.change(screen.getByTestId('tap-form-default-drinker'), { target: { value: '2' } });
    fireEvent.click(screen.getByTestId('tap-form-submit'));
    await flush();
    expect(updateTap).toHaveBeenCalledWith(5, { number: 2, name: 'Left', defaultDrinkerId: 2, hidden: false });
  });

  it('the default-drinker picker offers "No default" plus every drinker', async () => {
    render(<TapForm mode="create" tap={null} onSaved={vi.fn()} onCancel={vi.fn()} />);
    await flush();
    const select = screen.getByTestId('tap-form-default-drinker');
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(options).toEqual(['No default', 'Bob', 'Sam']);
  });

  it('surfaces a server error (e.g. a duplicate tap number) without calling onSaved', async () => {
    (createTap as Mock).mockResolvedValue({ ok: false, status: 409, message: 'taps.number already exists' });
    const onSaved = vi.fn();
    render(<TapForm mode="create" tap={null} onSaved={onSaved} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByTestId('tap-form-number'), { target: { value: '1' } });
    fireEvent.click(screen.getByTestId('tap-form-submit'));
    await flush();
    expect(screen.getByTestId('tap-form-server-error')).toHaveTextContent('taps.number already exists');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('calls onCancel without saving anything', () => {
    const onCancel = vi.fn();
    render(<TapForm mode="create" tap={null} onSaved={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId('tap-form-cancel'));
    expect(onCancel).toHaveBeenCalled();
    expect(createTap).not.toHaveBeenCalled();
  });
});
