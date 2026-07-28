/**
 * Card template + per-field visibility shared by `TapCard` (the wall/menu render path)
 * and the wall editor (`WallEditor`/`wallEditorConfig`, Task 7). Lives in `lib/` rather
 * than inside `components/TapCard.tsx` so the editor — which needs the exact same
 * per-template defaults to pre-fill its field toggles — doesn't have to import a
 * component module to get at plain config data. `TapCard.tsx` re-exports `CardTemplate`
 * from here for its existing import sites (e.g. `WallGrid.tsx`).
 */

export type CardTemplate = 'full' | 'standard' | 'compact' | 'minimal';

export const FIELD_KEYS = ['labelImage', 'brewery', 'style', 'description', 'abv', 'ibu', 'lastPour'] as const;
export type FieldKey = typeof FIELD_KEYS[number];
export type ResolvedFields = Record<FieldKey, boolean>;

/**
 * Per-template default field visibility: `full` (label art + all fields), `standard`
 * (everything full has, minus the description), `compact` (a dense row — just enough to
 * identify the beer), `minimal` (name + liquid only). A wall's `config.fields` overrides
 * individual keys on top of whichever template is active.
 */
export const TEMPLATE_DEFAULT_FIELDS: Record<CardTemplate, ResolvedFields> = {
  full: {
    labelImage: true, brewery: true, style: true, description: true, abv: true, ibu: true, lastPour: true,
  },
  standard: {
    labelImage: true, brewery: true, style: true, description: false, abv: true, ibu: true, lastPour: true,
  },
  compact: {
    labelImage: false, brewery: false, style: true, description: false, abv: true, ibu: false, lastPour: false,
  },
  minimal: {
    labelImage: false, brewery: false, style: false, description: false, abv: false, ibu: false, lastPour: false,
  },
};
