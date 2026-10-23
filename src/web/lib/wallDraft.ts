import { useMemo, useReducer } from 'react';
import type { WallConfigFormState } from './wallEditorConfig';

/**
 * The Wall Editor studio's state (Kegwall V2 M9, blueprint §E.3): one reducer holding the
 * last-saved values and the draft, instead of a dozen pieces of per-field state. Everything
 * the studio can change lives in `WallDraftValues` — the flat config form, the wall's name
 * and slug, and the Kegtron devices it draws taps from — so "unsaved changes", the per-section
 * dots on the rail and Discard all come from one comparison. The saved config stays
 * byte-compatible: the form still goes out through `parseWallConfigForm`.
 */
export interface WallDraftValues {
  form: WallConfigFormState;
  name: string;
  slug: string;
  /** `type:identifier` keys of the selected devices, sorted so order never reads as a change. */
  devices: string[];
}

export type WallSectionId =
  | 'look' | 'colors' | 'content' | 'pages' | 'takeover' | 'rotation' | 'fit' | 'css';

export interface WallSection {
  id: WallSectionId;
  label: string;
  /** One line under the section's title in the inspector. */
  hint: string;
  /** The form fields this section edits. Every form field belongs to exactly one section. */
  keys: readonly (keyof WallConfigFormState)[];
}

/** The studio rail, in order. */
export const WALL_SECTIONS: readonly WallSection[] = [
  {
    id: 'look',
    label: 'Look',
    hint: 'The layout of the whole screen. Every look shows the same taps, pours and pints.',
    keys: ['look', 'spotlightMode', 'spotlightTapId'],
  },
  {
    id: 'colors',
    label: 'Colors',
    hint: 'The wall’s ground and ink. Beer colors always come from each beer.',
    keys: ['themeId', 'themeOverrides'],
  },
  {
    id: 'content',
    label: 'What shows',
    hint: 'The wall’s name and address, its header, the ticker and what each tap shows.',
    keys: [
      'headerTitle', 'headerSubtitle', 'showClock', 'showTemp', 'ticker', 'showQr', 'showHostStats',
      'cardTemplate', 'fields', 'fillStyle', 'glyphMode',
    ],
  },
  {
    id: 'pages',
    label: 'Taps and pages',
    hint: 'Which Kegtron monitors feed this wall, and how its taps split into pages.',
    keys: ['pages', 'columns'],
  },
  {
    id: 'takeover',
    label: 'Pour takeover',
    hint: 'What the wall does while someone pours, and the moments it celebrates.',
    keys: [
      'takeoverStyle', 'takeoverMinMl', 'takeoverFinish', 'momentKicked', 'momentTapped', 'momentMilestone',
    ],
  },
  {
    id: 'rotation',
    label: 'Rotation and sleep',
    hint: 'How pages and views take turns, and when the screen rests.',
    keys: [
      'rotationSeconds', 'transition', 'viewRotationEnabled', 'viewRotationViews',
      'displayPowerScreensaverAfterMinutes', 'displayPowerOffAfterMinutes', 'displayPowerCameraMotion',
    ],
  },
  {
    id: 'fit',
    label: 'Screen fit',
    hint: 'The TV this wall runs on, so type reads the same across the room.',
    keys: ['displaySizeIn', 'displayResolution', 'displayUiScale'],
  },
  {
    id: 'css',
    label: 'Custom CSS',
    hint: 'Extra styles for this wall only. Checked before it saves.',
    keys: ['customCss'],
  },
];

export interface WallDraftState {
  saved: WallDraftValues;
  draft: WallDraftValues;
}

export type WallDraftAction =
  | { type: 'patch'; patch: Partial<WallConfigFormState> }
  | { type: 'meta'; name?: string; slug?: string }
  | { type: 'devices'; devices: string[] }
  /** The wall's device set arrived from the server: it is both saved and drafted. */
  | { type: 'devicesLoaded'; devices: string[] }
  | { type: 'revert'; section?: WallSectionId }
  /** A save went through. `devices: false` when only the config half landed. */
  | { type: 'saved'; devices: boolean };

function sortedDevices(devices: Iterable<string>): string[] {
  return [...new Set(devices)].sort();
}

export function initialWallDraft(values: WallDraftValues): WallDraftState {
  const clean = { ...values, devices: sortedDevices(values.devices) };
  return { saved: clean, draft: clean };
}

export function wallDraftReducer(state: WallDraftState, action: WallDraftAction): WallDraftState {
  switch (action.type) {
    case 'patch':
      return { ...state, draft: { ...state.draft, form: { ...state.draft.form, ...action.patch } } };
    case 'meta':
      return {
        ...state,
        draft: {
          ...state.draft,
          ...(action.name !== undefined ? { name: action.name } : {}),
          ...(action.slug !== undefined ? { slug: action.slug } : {}),
        },
      };
    case 'devices':
      return { ...state, draft: { ...state.draft, devices: sortedDevices(action.devices) } };
    case 'devicesLoaded': {
      const devices = sortedDevices(action.devices);
      return { saved: { ...state.saved, devices }, draft: { ...state.draft, devices } };
    }
    case 'revert': {
      if (!action.section) return { ...state, draft: state.saved };
      const section = WALL_SECTIONS.find((s) => s.id === action.section);
      if (!section) return state;
      const form = { ...state.draft.form };
      for (const key of section.keys) {
        (form as Record<string, unknown>)[key] = state.saved.form[key];
      }
      const draft: WallDraftValues = { ...state.draft, form };
      if (section.id === 'content') {
        draft.name = state.saved.name;
        draft.slug = state.saved.slug;
      }
      if (section.id === 'pages') draft.devices = state.saved.devices;
      return { ...state, draft };
    }
    case 'saved':
      return {
        ...state,
        saved: action.devices
          ? state.draft
          : { ...state.draft, devices: state.saved.devices },
      };
    default:
      return state;
  }
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The sections whose draft differs from what is saved (the rail's dots). */
export function dirtySections(state: WallDraftState): Set<WallSectionId> {
  const dirty = new Set<WallSectionId>();
  const { saved, draft } = state;
  for (const section of WALL_SECTIONS) {
    if (section.keys.some((key) => !same(saved.form[key], draft.form[key]))) dirty.add(section.id);
  }
  if (saved.name !== draft.name || saved.slug !== draft.slug) dirty.add('content');
  if (!same(saved.devices, draft.devices)) dirty.add('pages');
  return dirty;
}

/** `useReducer` over `wallDraftReducer`, plus the derived dirty-section set. */
export function useWallDraft(initial: () => WallDraftValues) {
  const [state, dispatch] = useReducer(wallDraftReducer, undefined, () => initialWallDraft(initial()));
  const dirty = useMemo(() => dirtySections(state), [state]);
  return { state, draft: state.draft, saved: state.saved, dirty, dispatch };
}
