import { describe, it, expect } from 'vitest';
import { wallConfigSchema, type WallConfig } from '../../src/server/core/wallConfig';
import {
  WALL_TOKEN_KEYS, defaultFormState, configToFormState, formStateToConfigCandidate,
  parseWallConfigForm, formatZodIssue,
} from '../../src/web/lib/wallEditorConfig';
import { TEMPLATE_DEFAULT_FIELDS } from '../../src/web/lib/cardFields';

describe('wallEditorConfig — the form state <-> WallConfig round trip', () => {
  it('defaults: an empty schema-parsed config deserializes, then re-serializes to an equivalent, still-valid config', () => {
    const defaults = wallConfigSchema.parse({});
    const form = configToFormState(defaults);

    const result = parseWallConfigForm(form, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Every scalar/structural field round-trips exactly...
    expect(result.config.columns).toBe(defaults.columns);
    expect(result.config.cardTemplate).toBe(defaults.cardTemplate);
    expect(result.config.theme).toEqual(defaults.theme);
    expect(result.config.pages).toEqual(defaults.pages);
    expect(result.config.rotationSeconds).toBe(defaults.rotationSeconds);
    expect(result.config.transition).toBe(defaults.transition);
    expect(result.config.showQr).toBe(defaults.showQr);
    expect(result.config.header).toEqual(defaults.header);
    expect(result.config.ticker).toBe(defaults.ticker);
    expect(result.config.customCss).toBe(defaults.customCss);
    expect(result.config.screensaver).toEqual(defaults.screensaver);
    // ...except `fields`: the schema's own default is `{}` (implicit "use the template's
    // defaults"), but the editor always shows every known toggle with a real value so an
    // admin can see and change each one — so it re-serializes as the standard template's
    // fully explicit map instead of staying `{}`. Functionally identical (TapCard's
    // `resolveFields` fills the same defaults for an empty override map), not byte-identical.
    expect(result.config.fields).toEqual(TEMPLATE_DEFAULT_FIELDS[defaults.cardTemplate]);
  });

  it('a bare default form state matches configToFormState(wallConfigSchema.parse({}))', () => {
    expect(defaultFormState()).toEqual(configToFormState(wallConfigSchema.parse({})));
  });

  it('full config: every field populated round-trips byte-for-byte through deserialize -> serialize -> parse', () => {
    const full: WallConfig = {
      columns: 4,
      cardTemplate: 'full',
      theme: { id: 'mono', overrides: { '--bg': '#111111', '--accent': '#ff0000' } },
      pages: [{ tapIds: [1, 2] }, { tapIds: [3] }],
      rotationSeconds: 30,
      transition: 'slide',
      showQr: true,
      header: { title: 'Taproom', showClock: true, showTemp: true },
      ticker: 'Welcome to the taproom!',
      fields: {
        labelImage: false, brewery: true, style: true, description: true, abv: true, ibu: false, lastPour: true,
      },
      customCss: '.kegtron-theme-scope { letter-spacing: 0.05em; }',
      screensaver: { enabled: true, startAfterMinutes: 7 },
    };
    // Sanity: the fixture itself must be valid per the schema.
    expect(() => wallConfigSchema.parse(full)).not.toThrow();

    const form = configToFormState(full);
    const result = parseWallConfigForm(form, [1, 2, 3]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toEqual(full);
  });

  it('unknown-tap pruning: a page referencing a tap id outside the currently known tap set drops it on save', () => {
    const config = wallConfigSchema.parse({
      pages: [{ tapIds: [1, 999] }, { tapIds: [999] }],
    });
    const form = configToFormState(config);

    const result = parseWallConfigForm(form, [1, 2]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.pages).toEqual([{ tapIds: [1] }, { tapIds: [] }]);
  });

  it('theme overrides: only the known token keys with a non-empty value survive the round trip', () => {
    const config = wallConfigSchema.parse({
      theme: { id: 'bright', overrides: { '--accent': '#abcdef', '--unknown-token': 'nope' } },
    });
    const form = configToFormState(config);
    // Only the 6 known override tokens are exposed to the editor.
    expect(Object.keys(form.themeOverrides).sort()).toEqual([...WALL_TOKEN_KEYS].sort());
    expect(form.themeOverrides['--accent']).toBe('#abcdef');
    expect(form.themeOverrides['--bg']).toBe('');

    const result = parseWallConfigForm(form, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Blank override fields don't produce a meaningless empty-string CSS value.
    expect(result.config.theme.overrides).toEqual({ '--accent': '#abcdef' });
  });

  it('an all-blank theme override map serializes with no overrides key at all', () => {
    const form = defaultFormState();
    const result = parseWallConfigForm(form, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.theme.overrides).toBeUndefined();
  });

  it('blank optional strings (ticker, header title, customCss) are omitted, not sent as empty strings', () => {
    const form = defaultFormState();
    const candidate = formStateToConfigCandidate(form, []) as Record<string, unknown>;
    expect(candidate.ticker).toBeUndefined();
    expect(candidate.customCss).toBeUndefined();
    expect((candidate.header as Record<string, unknown>).title).toBeUndefined();
  });

  it('zod-error surfacing: an out-of-range value fails parseWallConfigForm with a friendly, field-naming message', () => {
    const form = defaultFormState();
    form.rotationSeconds = 1; // schema min is 3
    const result = parseWallConfigForm(form, []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/rotationSeconds/i);
  });

  it('zod-error surfacing: multiple invalid fields all surface, formatted with a human path', () => {
    const form = defaultFormState();
    form.columns = 0; // schema min is 1
    form.screensaverStartAfterMinutes = 0; // schema min is 1
    const result = parseWallConfigForm(form, []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /columns/i.test(e))).toBe(true);
    expect(result.errors.some((e) => /screensaver/i.test(e) && /startAfterMinutes/i.test(e))).toBe(true);
  });

  it('formatZodIssue renders a nested path with the message', () => {
    const issue = { path: ['screensaver', 'startAfterMinutes'], message: 'Too small', code: 'too_small' } as never;
    expect(formatZodIssue(issue)).toBe('screensaver.startAfterMinutes: Too small');
  });

  it('formatZodIssue renders a root-level issue with no path prefix', () => {
    const issue = { path: [], message: 'Invalid input', code: 'custom' } as never;
    expect(formatZodIssue(issue)).toBe('Invalid input');
  });
});
