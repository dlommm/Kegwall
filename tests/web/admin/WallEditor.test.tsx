import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import type { Mock } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { WallEditor } from '../../../src/web/routes/admin/WallEditor';
import {
  listTaps, listMonitors, updateWall, getWallDevices, setWallDevices,
} from '../../../src/web/lib/adminApi';
import type { Wall } from '../../../src/web/lib/adminApi';
import { wallConfigSchema } from '../../../src/server/core/wallConfig';

vi.mock('../../../src/web/lib/adminApi', () => ({
  listTaps: vi.fn(),
  listMonitors: vi.fn(),
  updateWall: vi.fn(),
  getWallDevices: vi.fn(),
  setWallDevices: vi.fn(),
}));

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function makeWall(overrides: Partial<Wall> = {}): Wall {
  return {
    id: 1,
    slug: 'main-bar',
    name: 'Main bar',
    config: wallConfigSchema.parse({}),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (listTaps as Mock).mockResolvedValue({
    ok: true,
    data: [
      { id: 1, number: 1, name: 'Left' },
      { id: 2, number: 2, name: 'Right' },
    ],
  });
  // One 2-port device feeding both taps, already assigned to the wall — keeps the
  // editor's device-scoped tap pool identical to the full tap list for the
  // pre-existing tests.
  (listMonitors as Mock).mockResolvedValue({
    ok: true,
    data: [
      {
        id: 10, type: 'kegtron_pro', identifier: 'dev1', serial: 'SN1', portIndex: 0,
        tapId: 1, lastSeen: null, meta: {}, name: null, enabled: true, deviceKeg: null,
      },
      {
        id: 11, type: 'kegtron_pro', identifier: 'dev1', serial: 'SN1', portIndex: 1,
        tapId: 2, lastSeen: null, meta: {}, name: null, enabled: true, deviceKeg: null,
      },
    ],
  });
  (getWallDevices as Mock).mockResolvedValue({
    ok: true, data: [{ type: 'kegtron_pro', identifier: 'dev1' }],
  });
  (setWallDevices as Mock).mockResolvedValue({
    ok: true, data: [{ type: 'kegtron_pro', identifier: 'dev1' }],
  });
});

describe('WallEditor', () => {
  it('loads the wall into the form (name, slug, columns, template)', async () => {
    const wall = makeWall({
      name: 'Front bar',
      slug: 'front-bar',
      config: wallConfigSchema.parse({ columns: 4, cardTemplate: 'compact' }),
    });
    render(<WallEditor wall={wall} onBack={vi.fn()} onSaved={vi.fn()} />);
    await flush();

    expect(screen.getByTestId('wall-editor-name')).toHaveValue('Front bar');
    expect(screen.getByTestId('wall-editor-slug')).toHaveValue('front-bar');
    expect(screen.getByTestId('wall-editor-columns')).toHaveValue('4');
    expect(screen.getByTestId('wall-editor-template')).toHaveValue('compact');
  });

  it("loads the wall's fillStyle into the 'Fill style' dropdown, defaulting to Beer-colored liquid", async () => {
    render(<WallEditor wall={makeWall()} onBack={vi.fn()} onSaved={vi.fn()} />);
    await flush();
    expect(screen.getByTestId('wall-editor-fill-style')).toHaveValue('liquid');
  });

  it("loads an explicit fillStyle: 'keg' wall correctly", async () => {
    const wall = makeWall({ config: wallConfigSchema.parse({ fillStyle: 'keg' }) });
    render(<WallEditor wall={wall} onBack={vi.fn()} onSaved={vi.fn()} />);
    await flush();
    expect(screen.getByTestId('wall-editor-fill-style')).toHaveValue('keg');
  });

  it("changing 'Fill style' and saving sends the new value to updateWall", async () => {
    const savedWall = makeWall({ config: wallConfigSchema.parse({ fillStyle: 'keg' }) });
    (updateWall as Mock).mockResolvedValue({ ok: true, data: savedWall });
    render(<WallEditor wall={makeWall()} onBack={vi.fn()} onSaved={vi.fn()} />);
    await flush();

    fireEvent.change(screen.getByTestId('wall-editor-fill-style'), { target: { value: 'keg' } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('wall-editor-form'));
    });

    expect(updateWall).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ config: expect.objectContaining({ fillStyle: 'keg' }) }),
    );
  });

  describe('toolbar + chrome (redesign 1c)', () => {
    it('Save to TVs is disabled until there are unsaved changes, and the status reflects it', async () => {
      render(<WallEditor wall={makeWall()} onBack={vi.fn()} onSaved={vi.fn()} />);
      await flush();
      expect(screen.getByTestId('wall-editor-save')).toBeDisabled();
      expect(screen.getByTestId('wall-editor-save')).toHaveTextContent('Save to TVs');
      expect(screen.getByTestId('wall-editor-status')).toHaveTextContent(/in sync/i);

      fireEvent.change(screen.getByTestId('wall-editor-name'), { target: { value: 'New name' } });
      expect(screen.getByTestId('wall-editor-save')).toBeEnabled();
      expect(screen.getByTestId('wall-editor-status')).toHaveTextContent(/unsaved/i);
    });

    it('the first-time banner can be dismissed', async () => {
      render(<WallEditor wall={makeWall()} onBack={vi.fn()} onSaved={vi.fn()} />);
      await flush();
      expect(screen.getByTestId('wall-editor-banner')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('wall-editor-banner-dismiss'));
      expect(screen.queryByTestId('wall-editor-banner')).toBeNull();
    });

    it('settings search hides non-matching sections', async () => {
      render(<WallEditor wall={makeWall()} onBack={vi.fn()} onSaved={vi.fn()} />);
      await flush();
      expect(screen.getByTestId('wall-editor-display-fit')).toBeVisible();
      fireEvent.change(screen.getByTestId('wall-editor-search'), { target: { value: 'theme' } });
      expect(screen.getByTestId('wall-editor-display-fit')).not.toBeVisible();
    });

    it('Simulate a pour runs the selected takeover overlay in the live preview', async () => {
      render(
        <WallEditor
          wall={makeWall({ config: wallConfigSchema.parse({ look: 'ledger', takeover: { style: 'full', minMl: 60 } }) })}
          onBack={vi.fn()}
          onSaved={vi.fn()}
        />,
      );
      await flush();
      vi.useFakeTimers();
      try {
        act(() => { fireEvent.click(screen.getByTestId('wall-editor-simulate-pour')); });
        act(() => { vi.advanceTimersByTime(1200); });
        expect(screen.getByTestId('takeover-full')).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('Display fit (redesign 1c)', () => {
    it('picking a screen size snaps the UI scale to the recommended value', async () => {
      render(<WallEditor wall={makeWall()} onBack={vi.fn()} onSaved={vi.fn()} />);
      await flush();
      // Default 55" / 1080p → 100%.
      expect(screen.getByTestId('wall-editor-display-ui-scale-label')).toHaveTextContent('100%');
      fireEvent.change(screen.getByTestId('wall-editor-display-size'), { target: { value: '32' } });
      expect(screen.getByTestId('wall-editor-display-ui-scale-label')).toHaveTextContent('110%');
    });

    it('resolution snaps the scale; the slider nudges it; reset restores recommended', async () => {
      render(<WallEditor wall={makeWall()} onBack={vi.fn()} onSaved={vi.fn()} />);
      await flush();
      fireEvent.click(screen.getByTestId('wall-editor-display-resolution-720p'));
      expect(screen.getByTestId('wall-editor-display-ui-scale-label')).toHaveTextContent('115%');
      fireEvent.change(screen.getByTestId('wall-editor-display-ui-scale'), { target: { value: '130' } });
      expect(screen.getByTestId('wall-editor-display-ui-scale-label')).toHaveTextContent('130%');
      fireEvent.click(screen.getByTestId('wall-editor-display-ui-scale-reset'));
      expect(screen.getByTestId('wall-editor-display-ui-scale-label')).toHaveTextContent('115%');
    });

    it('saving persists the display config', async () => {
      (updateWall as Mock).mockResolvedValue({ ok: true, data: makeWall() });
      render(<WallEditor wall={makeWall()} onBack={vi.fn()} onSaved={vi.fn()} />);
      await flush();
      fireEvent.change(screen.getByTestId('wall-editor-display-size'), { target: { value: '65' } });
      fireEvent.click(screen.getByTestId('wall-editor-display-resolution-4k'));
      await act(async () => { fireEvent.submit(screen.getByTestId('wall-editor-form')); });
      expect(updateWall).toHaveBeenCalledWith(1, expect.objectContaining({
        config: expect.objectContaining({ display: { sizeIn: 65, resolution: '4k', uiScale: 0.9 } }),
      }));
    });
  });

  describe('Display power (Task 12)', () => {
    it('loads default (never-engage) displayPower into blank inputs and an unchecked camera checkbox', async () => {
      render(<WallEditor wall={makeWall()} onBack={vi.fn()} onSaved={vi.fn()} />);
      await flush();
      expect(screen.getByTestId('wall-editor-display-power-screensaver-minutes')).toHaveValue(null);
      expect(screen.getByTestId('wall-editor-display-power-off-minutes')).toHaveValue(null);
      expect(screen.getByTestId('wall-editor-display-power-camera-motion')).not.toBeChecked();
    });

    it('loads an explicit non-default displayPower into the three fields', async () => {
      const wall = makeWall({
        config: wallConfigSchema.parse({
          displayPower: { screensaverAfterMinutes: 5, offAfterMinutes: 20, cameraMotion: true },
        }),
      });
      render(<WallEditor wall={wall} onBack={vi.fn()} onSaved={vi.fn()} />);
      await flush();
      expect(screen.getByTestId('wall-editor-display-power-screensaver-minutes')).toHaveValue(5);
      expect(screen.getByTestId('wall-editor-display-power-off-minutes')).toHaveValue(20);
      expect(screen.getByTestId('wall-editor-display-power-camera-motion')).toBeChecked();
    });

    it('editing all three fields and saving sends the new displayPower object to updateWall', async () => {
      const savedWall = makeWall();
      (updateWall as Mock).mockResolvedValue({ ok: true, data: savedWall });
      render(<WallEditor wall={makeWall()} onBack={vi.fn()} onSaved={vi.fn()} />);
      await flush();

      fireEvent.change(screen.getByTestId('wall-editor-display-power-screensaver-minutes'), { target: { value: '10' } });
      fireEvent.change(screen.getByTestId('wall-editor-display-power-off-minutes'), { target: { value: '30' } });
      fireEvent.click(screen.getByTestId('wall-editor-display-power-camera-motion'));
      await act(async () => {
        fireEvent.submit(screen.getByTestId('wall-editor-form'));
      });

      expect(updateWall).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          config: expect.objectContaining({
            displayPower: { screensaverAfterMinutes: 10, offAfterMinutes: 30, cameraMotion: true },
          }),
        }),
      );
    });

    it('clearing a filled-in minutes field back to blank saves it as null', async () => {
      const wall = makeWall({
        config: wallConfigSchema.parse({
          displayPower: { screensaverAfterMinutes: 5, offAfterMinutes: null, cameraMotion: false },
        }),
      });
      const savedWall = makeWall();
      (updateWall as Mock).mockResolvedValue({ ok: true, data: savedWall });
      render(<WallEditor wall={wall} onBack={vi.fn()} onSaved={vi.fn()} />);
      await flush();

      fireEvent.change(screen.getByTestId('wall-editor-display-power-screensaver-minutes'), { target: { value: '' } });
      await act(async () => {
        fireEvent.submit(screen.getByTestId('wall-editor-form'));
      });

      expect(updateWall).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          config: expect.objectContaining({
            displayPower: { screensaverAfterMinutes: null, offAfterMinutes: null, cameraMotion: false },
          }),
        }),
      );
    });
  });

  it('renders the pages builder once taps have loaded', async () => {
    render(<WallEditor wall={makeWall()} onBack={vi.fn()} onSaved={vi.fn()} />);
    expect(await screen.findByTestId('wall-pages-builder')).toBeInTheDocument();
    expect(listTaps).toHaveBeenCalled();
  });

  it('always shows the custom-CSS trust warning', async () => {
    render(<WallEditor wall={makeWall()} onBack={vi.fn()} onSaved={vi.fn()} />);
    await flush();
    expect(screen.getByTestId('wall-editor-css-warning')).toHaveTextContent(
      'Custom CSS runs on every screen showing this wall — only paste CSS you trust',
    );
  });

  it('shows an inline live preview that renders the draft config immediately, no save round-trip', async () => {
    render(<WallEditor wall={makeWall({ slug: 'main-bar' })} onBack={vi.fn()} onSaved={vi.fn()} />);
    await flush();
    expect(screen.getByTestId('wall-live-preview')).toBeInTheDocument();
    expect(screen.getByTestId('wall-editor-live-note')).toHaveTextContent(/live/i);
    // Changing the look updates the preview instantly — without saving.
    fireEvent.change(screen.getByTestId('wall-editor-look'), { target: { value: 'ledger' } });
    expect(screen.getByTestId('ledger-look')).toBeInTheDocument();
    expect(updateWall).not.toHaveBeenCalled();
  });

  it('preview-size control resizes the preview, persists per-user, and never counts as a dirty edit', async () => {
    localStorage.removeItem('kegwall:wallEditor:previewSize');
    render(<WallEditor wall={makeWall()} onBack={vi.fn()} onSaved={vi.fn()} />);
    await flush();

    // Defaults to 'Large' (bigger than the old fixed column) — the grid carries the modifier class.
    const grid = screen.getByTestId('wall-editor-form').parentElement!;
    expect(grid).toHaveClass('wall-editor--preview-l');
    expect(screen.getByTestId('wall-editor-preview-size-l')).toHaveAttribute('aria-pressed', 'true');

    // Switching to 'Stacked' updates the layout and persists the choice to localStorage…
    fireEvent.click(screen.getByTestId('wall-editor-preview-size-stacked'));
    expect(grid).toHaveClass('wall-editor--preview-stacked');
    expect(grid).not.toHaveClass('wall-editor--preview-l');
    expect(localStorage.getItem('kegwall:wallEditor:previewSize')).toBe('stacked');

    // …and it's a view preference, not wall config: Save stays disabled (no dirty edit).
    expect(screen.getByTestId('wall-editor-save')).toBeDisabled();
    expect(updateWall).not.toHaveBeenCalled();
  });

  it('restores the persisted preview size on next open', async () => {
    localStorage.setItem('kegwall:wallEditor:previewSize', 'xl');
    render(<WallEditor wall={makeWall()} onBack={vi.fn()} onSaved={vi.fn()} />);
    await flush();
    const grid = screen.getByTestId('wall-editor-form').parentElement!;
    expect(grid).toHaveClass('wall-editor--preview-xl');
  });

  it('Back calls onBack', async () => {
    const onBack = vi.fn();
    render(<WallEditor wall={makeWall()} onBack={onBack} onSaved={vi.fn()} />);
    await flush();
    fireEvent.click(screen.getByTestId('wall-editor-back'));
    expect(onBack).toHaveBeenCalled();
  });

  it('saving sends the edited fields through the validated config to updateWall, then notifies onSaved', async () => {
    const onSaved = vi.fn();
    const savedWall = makeWall({ config: wallConfigSchema.parse({ rotationSeconds: 45 }) });
    (updateWall as Mock).mockResolvedValue({ ok: true, data: savedWall });
    render(<WallEditor wall={makeWall()} onBack={vi.fn()} onSaved={onSaved} />);
    await flush();

    fireEvent.change(screen.getByTestId('wall-editor-rotation'), { target: { value: '45' } });
    fireEvent.click(screen.getByTestId('wall-editor-save'));
    await flush();

    expect(updateWall).toHaveBeenCalledTimes(1);
    const [wallId, input] = (updateWall as Mock).mock.calls[0]!;
    expect(wallId).toBe(1);
    expect(input.name).toBe('Main bar');
    expect(input.slug).toBe('main-bar');
    expect(input.config.rotationSeconds).toBe(45);
    expect(onSaved).toHaveBeenCalledWith(savedWall);
    expect(screen.getByTestId('wall-editor-saved-notice')).toBeInTheDocument();
  });

  it('renaming the slug and saving sends the new slug to updateWall', async () => {
    const savedWall = makeWall({ slug: 'renamed' });
    (updateWall as Mock).mockResolvedValue({ ok: true, data: savedWall });
    render(<WallEditor wall={makeWall({ slug: 'main-bar' })} onBack={vi.fn()} onSaved={vi.fn()} />);
    await flush();

    fireEvent.change(screen.getByTestId('wall-editor-slug'), { target: { value: 'renamed' } });
    fireEvent.click(screen.getByTestId('wall-editor-save'));
    await flush();

    expect(updateWall).toHaveBeenCalledWith(1, expect.objectContaining({ slug: 'renamed' }));
  });

  it('zod-error surfacing: an out-of-range rotation seconds value blocks the save with a friendly message, and never calls updateWall', async () => {
    render(<WallEditor wall={makeWall()} onBack={vi.fn()} onSaved={vi.fn()} />);
    await flush();

    fireEvent.change(screen.getByTestId('wall-editor-rotation'), { target: { value: '1' } });
    fireEvent.click(screen.getByTestId('wall-editor-save'));
    await flush();

    expect(updateWall).not.toHaveBeenCalled();
    const errors = screen.getByTestId('wall-editor-errors');
    expect(errors).toHaveTextContent(/rotationSeconds/i);
  });

  it('rejects an invalid slug client-side before ever calling updateWall', async () => {
    render(<WallEditor wall={makeWall()} onBack={vi.fn()} onSaved={vi.fn()} />);
    await flush();

    fireEvent.change(screen.getByTestId('wall-editor-slug'), { target: { value: 'Not A Slug!' } });
    fireEvent.click(screen.getByTestId('wall-editor-save'));
    await flush();

    expect(updateWall).not.toHaveBeenCalled();
    expect(screen.getByTestId('wall-editor-errors')).toHaveTextContent(/lowercase/i);
  });

  it('a server-side save failure (e.g. slug conflict) surfaces the message and does not call onSaved', async () => {
    const onSaved = vi.fn();
    (updateWall as Mock).mockResolvedValue({ ok: false, status: 409, message: 'slug already in use' });
    render(<WallEditor wall={makeWall()} onBack={vi.fn()} onSaved={onSaved} />);
    await flush();

    // Save is dirty-gated (redesign 1c) — make an edit so the button enables, then save.
    fireEvent.change(screen.getByTestId('wall-editor-name'), { target: { value: 'Main bar renamed' } });
    fireEvent.click(screen.getByTestId('wall-editor-save'));
    await flush();

    expect(screen.getByTestId('wall-editor-errors')).toHaveTextContent('slug already in use');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('field toggles pre-fill from the active template default and can be switched off', async () => {
    render(<WallEditor wall={makeWall({ config: wallConfigSchema.parse({ cardTemplate: 'standard' }) })} onBack={vi.fn()} onSaved={vi.fn()} />);
    await flush();

    // standard template defaults `description` to false, `brewery` to true.
    expect(screen.getByTestId('wall-editor-field-description')).not.toBeChecked();
    expect(screen.getByTestId('wall-editor-field-brewery')).toBeChecked();

    fireEvent.click(screen.getByTestId('wall-editor-field-brewery'));
    expect(screen.getByTestId('wall-editor-field-brewery')).not.toBeChecked();
  });

  it('switching card template resyncs the field checkboxes to the new template\'s defaults', async () => {
    render(<WallEditor wall={makeWall({ config: wallConfigSchema.parse({ cardTemplate: 'full' }) })} onBack={vi.fn()} onSaved={vi.fn()} />);
    await flush();

    // `full` defaults every field to true.
    expect(screen.getByTestId('wall-editor-field-description')).toBeChecked();
    expect(screen.getByTestId('wall-editor-field-ibu')).toBeChecked();

    fireEvent.change(screen.getByTestId('wall-editor-template'), { target: { value: 'minimal' } });

    // `minimal` defaults every field to false — the checkboxes must reflect that
    // immediately, not still show `full`'s all-true state.
    expect(screen.getByTestId('wall-editor-field-description')).not.toBeChecked();
    expect(screen.getByTestId('wall-editor-field-ibu')).not.toBeChecked();
    expect(screen.getByTestId('wall-editor-field-labelImage')).not.toBeChecked();
    expect(screen.getByTestId('wall-editor-field-brewery')).not.toBeChecked();
    expect(screen.getByTestId('wall-editor-field-style')).not.toBeChecked();
    expect(screen.getByTestId('wall-editor-field-abv')).not.toBeChecked();
    expect(screen.getByTestId('wall-editor-field-lastPour')).not.toBeChecked();
  });

  it('switch-then-save serializes the NEW template\'s default fields map, not the old template\'s (the exact live-TV regression from review)', async () => {
    const savedWall = makeWall({ config: wallConfigSchema.parse({ cardTemplate: 'minimal' }) });
    (updateWall as Mock).mockResolvedValue({ ok: true, data: savedWall });
    render(<WallEditor wall={makeWall({ config: wallConfigSchema.parse({ cardTemplate: 'full' }) })} onBack={vi.fn()} onSaved={vi.fn()} />);
    await flush();

    fireEvent.change(screen.getByTestId('wall-editor-template'), { target: { value: 'minimal' } });
    fireEvent.click(screen.getByTestId('wall-editor-save'));
    await flush();

    expect(updateWall).toHaveBeenCalledTimes(1);
    const [, input] = (updateWall as Mock).mock.calls[0]!;
    // Every field false (minimal's defaults) — NOT full's all-true map.
    expect(input.config.fields).toEqual({
      labelImage: false, brewery: false, style: false, description: false, abv: false, ibu: false, lastPour: false,
    });
  });

  it('a token override can be set and cleared via its Reset control', async () => {
    render(<WallEditor wall={makeWall()} onBack={vi.fn()} onSaved={vi.fn()} />);
    await flush();

    const resetButton = screen.getByTestId('wall-editor-token-reset---accent');
    expect(resetButton).toBeDisabled();

    fireEvent.change(screen.getByTestId('wall-editor-token---accent'), { target: { value: '#ff00ff' } });
    expect(resetButton).not.toBeDisabled();

    fireEvent.click(screen.getByTestId('wall-editor-save'));
    await flush();
    expect(updateWall).toHaveBeenCalledTimes(1);
    const [, input] = (updateWall as Mock).mock.calls[0]!;
    expect(input.config.theme.overrides).toEqual({ '--accent': '#ff00ff' });

    fireEvent.click(resetButton);
    expect(screen.getByTestId('wall-editor-token-reset---accent')).toBeDisabled();
  });

  describe('devices panel (device→wall scoping)', () => {
    it('lists each physical device with a checkbox reflecting the wall\'s assignment', async () => {
      render(<WallEditor wall={makeWall()} onBack={vi.fn()} onSaved={vi.fn()} />);
      await flush();
      const devices = screen.getAllByTestId('wall-editor-device');
      expect(devices).toHaveLength(1);
      expect(devices[0]).toHaveTextContent('dev1');
      expect(devices[0]).toHaveTextContent('2 ports');
      expect(screen.getByTestId('wall-editor-device-checkbox')).toBeChecked();
      expect(screen.queryByTestId('wall-editor-devices-none-warning')).not.toBeInTheDocument();
    });

    it('unchecking every device warns that the wall will show no taps', async () => {
      render(<WallEditor wall={makeWall()} onBack={vi.fn()} onSaved={vi.fn()} />);
      await flush();
      fireEvent.click(screen.getByTestId('wall-editor-device-checkbox'));
      expect(screen.getByTestId('wall-editor-devices-none-warning'))
        .toHaveTextContent(/show no taps/i);
    });

    it('saving PUTs the device assignment before patching the wall', async () => {
      (updateWall as Mock).mockResolvedValue({ ok: true, data: makeWall() });
      render(<WallEditor wall={makeWall()} onBack={vi.fn()} onSaved={vi.fn()} />);
      await flush();

      fireEvent.click(screen.getByTestId('wall-editor-device-checkbox')); // uncheck
      await act(async () => {
        fireEvent.submit(screen.getByTestId('wall-editor-form'));
      });

      expect(setWallDevices).toHaveBeenCalledWith(1, []);
      expect(updateWall).toHaveBeenCalledTimes(1);
    });

    it('a device-assignment save failure surfaces the message and skips the wall PATCH', async () => {
      (setWallDevices as Mock).mockResolvedValue({ ok: false, status: 400, message: 'unknown device' });
      render(<WallEditor wall={makeWall()} onBack={vi.fn()} onSaved={vi.fn()} />);
      await flush();

      await act(async () => {
        fireEvent.submit(screen.getByTestId('wall-editor-form'));
      });

      expect(screen.getByTestId('wall-editor-errors')).toHaveTextContent('unknown device');
      expect(updateWall).not.toHaveBeenCalled();
    });
  });
});
