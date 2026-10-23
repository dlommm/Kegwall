import type { WallConfig } from '../../server/core/wallConfig.js';

/**
 * Names and one-line descriptions for the wall looks and pour takeover styles, shared by
 * every admin surface that offers them (the Wall Editor gallery, the Walls cards, per-display
 * overrides) so a look is never shown by its raw id.
 */
export interface LookOption {
  id: WallConfig['look'];
  label: string;
  blurb: string;
  /** Added in Kegwall V2. */
  isNew?: boolean;
}

export const LOOK_OPTIONS: readonly LookOption[] = [
  { id: 'just-tapped', label: 'Just Tapped', blurb: 'The newest keg up front, the rest in a list.', isNew: true },
  { id: 'handles', label: 'Tap Handles', blurb: 'A row of tall handles in each beer’s color.', isNew: true },
  { id: 'tally', label: 'Tally', blurb: 'A ledger of pints left, counted in strokes.', isNew: true },
  { id: 'classic', label: 'Classic', blurb: 'Cards in a grid with a glass for each beer.' },
  { id: 'ledger', label: 'Ledger', blurb: 'One line per tap, like a printed menu.' },
  { id: 'gallery', label: 'Gallery', blurb: 'Label art large, details underneath.' },
  { id: 'columns', label: 'Columns', blurb: 'Tall columns that fill to the keg level.' },
  { id: 'chalkboard', label: 'Chalkboard', blurb: 'Hand-lettered board, chalk on slate.' },
  { id: 'editorial', label: 'Editorial', blurb: 'Magazine type with a lead story.' },
  { id: 'neon', label: 'Neon', blurb: 'Glowing tubes on a dark wall.' },
  { id: 'terminal', label: 'Terminal', blurb: 'A green-screen readout.' },
  { id: 'poster', label: 'Poster', blurb: 'Big blocks of color and type.' },
  { id: 'departures', label: 'Departures', blurb: 'A station board with a flip for each tap.' },
  { id: 'zen', label: 'Zen', blurb: 'Quiet, spacious, one column.' },
];

export interface TakeoverOption {
  id: WallConfig['takeover']['style'];
  label: string;
  blurb: string;
}

export const TAKEOVER_OPTIONS: readonly TakeoverOption[] = [
  { id: 'full', label: 'Full screen', blurb: 'A glass fills on screen with a live count. Several pours share the screen.' },
  { id: 'tappull', label: 'Tap Pull', blurb: 'A faucet swings open and fills a tilted glass.' },
  { id: 'kegdrain', label: 'Keg Drain', blurb: 'The keg drains as it pours, in pints to two decimals.' },
  { id: 'spotlight', label: 'Spotlight', blurb: 'The pouring tap lifts and the rest dim.' },
  { id: 'split', label: 'Split', blurb: 'The wall slides aside for a pour panel.' },
  { id: 'dock', label: 'Dock', blurb: 'A pour bar rises along the bottom.' },
  { id: 'fill', label: 'Fill', blurb: 'The screen fills with the beer’s color.' },
  { id: 'gameon', label: 'Game On', blurb: 'Pours count toward the running game. Full screen when no game runs.' },
  { id: 'off', label: 'Badge', blurb: 'The wall stays still. The pouring tap shows a badge.' },
];

export function lookLabel(id: string | undefined | null): string {
  return LOOK_OPTIONS.find((l) => l.id === id)?.label ?? 'Classic';
}

export function takeoverLabel(id: string | undefined | null): string {
  return TAKEOVER_OPTIONS.find((t) => t.id === id)?.label ?? 'Badge';
}

/** The look's gallery picture: a 400 × 225 capture of the look on the seeded taproom. */
export function lookThumbUrl(id: WallConfig['look']): string {
  return `/looks/${id}.jpg`;
}
