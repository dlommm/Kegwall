import type { ZodIssue } from 'zod';
import { wallConfigSchema, type WallConfig } from '../../server/core/wallConfig.js';
import { FIELD_KEYS, TEMPLATE_DEFAULT_FIELDS, type CardTemplate, type FieldKey } from './cardFields';

/**
 * The wall editor's critical logic (Task 7): a pure, React-free mapping between the
 * editor's flat form state and `WallConfig`, validated on the way out by importing and
 * calling `wallConfigSchema` directly (the exact schema the server enforces on
 * `PATCH /api/walls/:id`) — so a save can never reach the server with a shape the server
 * would reject, and any validation failure surfaces as a friendly, field-naming message
 * before the request is even sent.
 *
 * The 6 theme tokens an admin can override from a color/value picker — every key in a
 * built-in theme's `tokens` map (see `themes.ts`) EXCEPT the 3 shared font tokens (those
 * are deliberately not overridable per-wall — see the design direction: "a theme is a
 * color + shape skin, not a different typographic identity").
 */
export const WALL_TOKEN_KEYS = ['--bg', '--surface', '--text', '--text-dim', '--accent', '--card-radius'] as const;
export type WallTokenKey = typeof WALL_TOKEN_KEYS[number];

export interface WallConfigFormState {
  columns: number;
  look: WallConfig['look'];
  glyphMode: WallConfig['glyphMode'];
  takeoverStyle: WallConfig['takeover']['style'];
  takeoverMinMl: number;
  cardTemplate: CardTemplate;
  themeId: string;
  /** Always has all 6 `WALL_TOKEN_KEYS`; `''` means "no override, inherit the theme's own value". */
  themeOverrides: Record<WallTokenKey, string>;
  /** Always has all 7 `FIELD_KEYS`, pre-filled with the active template's defaults. */
  fields: Record<FieldKey, boolean>;
  /** Raw, unmodified custom CSS text; `''` means none. */
  customCss: string;
  pages: { tapIds: number[] }[];
  rotationSeconds: number;
  transition: WallConfig['transition'];
  showQr: boolean;
  headerTitle: string;
  headerSubtitle: string;
  showClock: boolean;
  showTemp: boolean;
  ticker: string;
  screensaverEnabled: boolean;
  screensaverStartAfterMinutes: number;
  fillStyle: WallConfig['fillStyle'];
}

function emptyThemeOverrides(): Record<WallTokenKey, string> {
  const overrides = {} as Record<WallTokenKey, string>;
  for (const key of WALL_TOKEN_KEYS) overrides[key] = '';
  return overrides;
}

/** The form state a brand-new wall starts from — matches `wallConfigSchema.parse({})`. */
export function defaultFormState(): WallConfigFormState {
  return configToFormState(wallConfigSchema.parse({}));
}

/**
 * Deserializer: a fully-resolved `WallConfig` (already defaulted — e.g. via
 * `wallConfigSchema.parse(rawConfigFromServer)`, which fills anything a legacy stored
 * row is missing) -> the editor's flat form state.
 */
export function configToFormState(config: WallConfig): WallConfigFormState {
  const fields = { ...TEMPLATE_DEFAULT_FIELDS[config.cardTemplate] };
  for (const key of FIELD_KEYS) {
    const value = config.fields[key];
    if (typeof value === 'boolean') fields[key] = value;
  }

  const themeOverrides = emptyThemeOverrides();
  for (const key of WALL_TOKEN_KEYS) {
    const value = config.theme.overrides?.[key];
    if (typeof value === 'string') themeOverrides[key] = value;
  }

  return {
    columns: config.columns,
    look: config.look,
    glyphMode: config.glyphMode,
    takeoverStyle: config.takeover.style,
    takeoverMinMl: config.takeover.minMl,
    cardTemplate: config.cardTemplate,
    themeId: config.theme.id,
    themeOverrides,
    fields,
    customCss: config.customCss ?? '',
    pages: config.pages.map((page) => ({ tapIds: [...page.tapIds] })),
    rotationSeconds: config.rotationSeconds,
    transition: config.transition,
    showQr: config.showQr,
    headerTitle: config.header.title ?? '',
    headerSubtitle: config.header.subtitle ?? '',
    showClock: config.header.showClock,
    showTemp: config.header.showTemp,
    ticker: config.ticker ?? '',
    screensaverEnabled: config.screensaver.enabled,
    screensaverStartAfterMinutes: config.screensaver.startAfterMinutes,
    fillStyle: config.fillStyle,
  };
}

/**
 * Serializer: form state -> a plain candidate object shaped for `wallConfigSchema`, NOT
 * yet validated (see `parseWallConfigForm`, which is what every caller should actually
 * use). Two normalizations happen here regardless of validity:
 *  - `pages[].tapIds` is pruned to `validTapIds` — a page can't keep pointing at a tap
 *    that was deleted (or never existed) while the wall was being edited.
 *  - Blank optional strings (`ticker`, `header.title`, theme override values) are
 *    omitted rather than sent as `''`, since an empty string is either meaningless
 *    (an override CSS value) or should just mean "unset" (ticker/title).
 */
export function formStateToConfigCandidate(
  form: WallConfigFormState,
  validTapIds: readonly number[],
): unknown {
  const validSet = new Set(validTapIds);

  const overrides: Partial<Record<WallTokenKey, string>> = {};
  for (const key of WALL_TOKEN_KEYS) {
    const value = form.themeOverrides[key];
    if (value.trim() !== '') overrides[key] = value.trim();
  }

  const header: { title?: string; subtitle?: string; showClock: boolean; showTemp: boolean } = {
    showClock: form.showClock,
    showTemp: form.showTemp,
  };
  if (form.headerTitle.trim() !== '') header.title = form.headerTitle.trim();
  if (form.headerSubtitle.trim() !== '') header.subtitle = form.headerSubtitle.trim();

  const candidate: Record<string, unknown> = {
    columns: form.columns,
    look: form.look,
    glyphMode: form.glyphMode,
    takeover: { style: form.takeoverStyle, minMl: form.takeoverMinMl },
    cardTemplate: form.cardTemplate,
    theme: {
      id: form.themeId,
      ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
    },
    pages: form.pages.map((page) => ({
      tapIds: page.tapIds.filter((id) => validSet.has(id)),
    })),
    rotationSeconds: form.rotationSeconds,
    transition: form.transition,
    showQr: form.showQr,
    header,
    fields: { ...form.fields },
    screensaver: {
      enabled: form.screensaverEnabled,
      startAfterMinutes: form.screensaverStartAfterMinutes,
    },
    fillStyle: form.fillStyle,
  };
  if (form.ticker.trim() !== '') candidate.ticker = form.ticker.trim();
  if (form.customCss !== '') candidate.customCss = form.customCss;

  return candidate;
}

/** Human-friendly label for a zod issue's path prefix — a dotted path (nested objects,
 * e.g. `screensaver.startAfterMinutes`), or nothing at all for a root-level issue. */
export function formatZodIssue(issue: ZodIssue): string {
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

export type WallConfigParseResult =
  | { ok: true; config: WallConfig }
  | { ok: false; errors: string[] };

/**
 * The one function every save path should call: builds the candidate object, then runs
 * it through the REAL `wallConfigSchema` (imported, not re-implemented) so a save can
 * never send the server something it would reject. On failure, every zod issue is mapped
 * to a friendly message via `formatZodIssue` rather than surfacing raw zod internals.
 */
export function parseWallConfigForm(
  form: WallConfigFormState,
  validTapIds: readonly number[],
): WallConfigParseResult {
  const candidate = formStateToConfigCandidate(form, validTapIds);
  const result = wallConfigSchema.safeParse(candidate);
  if (result.success) return { ok: true, config: result.data };
  return { ok: false, errors: result.error.issues.map(formatZodIssue) };
}
