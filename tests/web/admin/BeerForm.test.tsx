import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import type { Mock } from 'vitest';
import {
  act, fireEvent, render, screen,
} from '@testing-library/react';
import { BeerForm } from '../../../src/web/routes/admin/BeerForm';
import { createBeer, updateBeer, uploadLabel, lookupBreweries } from '../../../src/web/lib/adminApi';
import { srmToColor } from '../../../src/web/lib/srm';
import type { Beer } from '../../../src/server/db/beers';

vi.mock('../../../src/web/lib/adminApi', () => ({
  createBeer: vi.fn(),
  updateBeer: vi.fn(),
  uploadLabel: vi.fn(),
  lookupBreweries: vi.fn(),
}));

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function makeBeer(overrides: Partial<Beer> = {}): Beer {
  return {
    id: 1, name: 'Citra IPA', brewery: 'Test Brewery', style: 'IPA', abv: 6.5, ibu: 60,
    srm: 6, description: 'Hoppy.', labelImage: '/labels/existing.png', createdAt: '2026-07-28T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (lookupBreweries as Mock).mockResolvedValue({ ok: true, data: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('BeerForm', () => {
  it('requires a name before submitting', async () => {
    render(<BeerForm mode="create" beer={null} onSaved={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByTestId('beer-form-submit'));
    await flush();
    expect(screen.getByTestId('beer-form-validation-error')).toHaveTextContent('Name is required.');
    expect(createBeer).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric ABV', async () => {
    render(<BeerForm mode="create" beer={null} onSaved={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByTestId('beer-form-name'), { target: { value: 'Test Beer' } });
    fireEvent.change(screen.getByTestId('beer-form-abv'), { target: { value: 'strong' } });
    fireEvent.click(screen.getByTestId('beer-form-submit'));
    await flush();
    expect(screen.getByTestId('beer-form-validation-error')).toHaveTextContent('ABV must be a number.');
    expect(createBeer).not.toHaveBeenCalled();
  });

  it('shows a live SRM color swatch that updates as the SRM field changes', async () => {
    render(<BeerForm mode="create" beer={null} onSaved={vi.fn()} onCancel={vi.fn()} />);
    const swatch = screen.getByTestId('beer-form-srm-swatch');
    fireEvent.change(screen.getByTestId('beer-form-srm'), { target: { value: '20' } });
    expect(swatch).toHaveStyle({ backgroundColor: srmToColor(20).liquid });
    fireEvent.change(screen.getByTestId('beer-form-srm'), { target: { value: '3' } });
    expect(swatch).toHaveStyle({ backgroundColor: srmToColor(3).liquid });
  });

  it('submits a valid create form with parsed numeric fields and null for blanks', async () => {
    const created = makeBeer({ id: 5 });
    (createBeer as Mock).mockResolvedValue({ ok: true, data: created });
    const onSaved = vi.fn();
    render(<BeerForm mode="create" beer={null} onSaved={onSaved} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByTestId('beer-form-name'), { target: { value: 'Citra IPA' } });
    fireEvent.change(screen.getByTestId('beer-form-abv'), { target: { value: '6.5' } });
    fireEvent.change(screen.getByTestId('beer-form-srm'), { target: { value: '6' } });
    fireEvent.click(screen.getByTestId('beer-form-submit'));
    await flush();

    expect(createBeer).toHaveBeenCalledWith({
      name: 'Citra IPA', brewery: null, style: null, abv: 6.5, ibu: null, srm: 6,
      description: null, labelImage: null,
    });
    expect(onSaved).toHaveBeenCalledWith(created);
  });

  it('pre-fills every field from the given beer in edit mode and PATCHes on submit', async () => {
    const beer = makeBeer();
    (updateBeer as Mock).mockResolvedValue({ ok: true, data: beer });
    const onSaved = vi.fn();
    render(<BeerForm mode="edit" beer={beer} onSaved={onSaved} onCancel={vi.fn()} />);

    expect(screen.getByTestId('beer-form-name')).toHaveValue('Citra IPA');
    expect(screen.getByTestId('style-input')).toHaveValue('IPA');
    expect(screen.getByTestId('beer-form-abv')).toHaveValue('6.5');
    expect(screen.getByTestId('beer-form-ibu')).toHaveValue('60');
    expect(screen.getByTestId('beer-form-srm')).toHaveValue('6');
    expect(screen.getByTestId('beer-form-description')).toHaveValue('Hoppy.');
    expect(screen.getByTestId('beer-form-label-thumb')).toHaveAttribute('src', '/labels/existing.png');

    fireEvent.change(screen.getByTestId('style-input'), { target: { value: 'Hazy IPA' } });
    fireEvent.click(screen.getByTestId('beer-form-submit'));
    await flush();

    expect(updateBeer).toHaveBeenCalledWith(1, expect.objectContaining({ style: 'Hazy IPA' }));
    expect(onSaved).toHaveBeenCalledWith(beer);
  });

  it('surfaces a server error message on a failed save without calling onSaved', async () => {
    (createBeer as Mock).mockResolvedValue({ ok: false, status: 500, message: 'Something went wrong' });
    const onSaved = vi.fn();
    render(<BeerForm mode="create" beer={null} onSaved={onSaved} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByTestId('beer-form-name'), { target: { value: 'Test Beer' } });
    fireEvent.click(screen.getByTestId('beer-form-submit'));
    await flush();
    expect(screen.getByTestId('beer-form-server-error')).toHaveTextContent('Something went wrong');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('calls onCancel without saving anything', () => {
    const onCancel = vi.fn();
    render(<BeerForm mode="create" beer={null} onSaved={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId('beer-form-cancel'));
    expect(onCancel).toHaveBeenCalled();
    expect(createBeer).not.toHaveBeenCalled();
  });

  it('uploads a chosen label file and shows the resulting thumbnail', async () => {
    (uploadLabel as Mock).mockResolvedValue({ ok: true, data: { path: '/labels/new.png' } });
    render(<BeerForm mode="create" beer={null} onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByTestId('beer-form-label-placeholder')).toBeInTheDocument();

    const file = new File(['bytes'], 'label.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('beer-form-label-file'), { target: { files: [file] } });
    await flush();

    expect(uploadLabel).toHaveBeenCalledWith(file);
    expect(screen.getByTestId('beer-form-label-thumb')).toHaveAttribute('src', '/labels/new.png');
  });

  it('shows an inline error when the label upload fails', async () => {
    (uploadLabel as Mock).mockResolvedValue({ ok: false, status: 413, message: 'File exceeds the 5MB limit' });
    render(<BeerForm mode="create" beer={null} onSaved={vi.fn()} onCancel={vi.fn()} />);
    const file = new File(['bytes'], 'label.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('beer-form-label-file'), { target: { files: [file] } });
    await flush();
    expect(screen.getByTestId('beer-form-label-error')).toHaveTextContent('File exceeds the 5MB limit');
  });

  it('picking a StyleAutocomplete suggestion fills the style field and is submitted as-is', async () => {
    (createBeer as Mock).mockResolvedValue({ ok: true, data: makeBeer({ style: 'Hazy IPA' }) });
    render(<BeerForm mode="create" beer={null} onSaved={vi.fn()} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByTestId('beer-form-name'), { target: { value: 'Test Beer' } });
    const styleInput = screen.getByTestId('style-input');
    fireEvent.change(styleInput, { target: { value: 'Hazy IP' } });
    fireEvent.focus(styleInput);
    fireEvent.click(screen.getByText('Hazy IPA'));
    expect(styleInput).toHaveValue('Hazy IPA');

    fireEvent.click(screen.getByTestId('beer-form-submit'));
    await flush();
    expect(createBeer).toHaveBeenCalledWith(expect.objectContaining({ style: 'Hazy IPA' }));
  });

  it('allows a free-text style not in the BJCP list — never blocked or overwritten', async () => {
    (createBeer as Mock).mockResolvedValue({ ok: true, data: makeBeer({ style: 'House Blend' }) });
    render(<BeerForm mode="create" beer={null} onSaved={vi.fn()} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByTestId('beer-form-name'), { target: { value: 'Test Beer' } });
    fireEvent.change(screen.getByTestId('style-input'), { target: { value: 'House Blend' } });
    fireEvent.click(screen.getByTestId('beer-form-submit'));
    await flush();
    expect(createBeer).toHaveBeenCalledWith(expect.objectContaining({ style: 'House Blend' }));
  });
});
