import { describe, it, expect } from 'vitest';
import {
  WALL_SECTIONS, dirtySections, initialWallDraft, wallDraftReducer,
} from '../../src/web/lib/wallDraft';
import { configToFormState, defaultFormState } from '../../src/web/lib/wallEditorConfig';
import { wallConfigSchema } from '../../src/server/core/wallConfig';

function start() {
  return initialWallDraft({ form: defaultFormState(), name: 'Main', slug: 'main', devices: ['kegtron_pro:b', 'kegtron_pro:a'] });
}

describe('wallDraft', () => {
  it('puts every form field in exactly one rail section', () => {
    const keys = WALL_SECTIONS.flatMap((s) => s.keys);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(Object.keys(defaultFormState()).sort());
  });

  it('starts clean, with devices sorted so order never reads as a change', () => {
    const state = start();
    expect(state.saved.devices).toEqual(['kegtron_pro:a', 'kegtron_pro:b']);
    expect(dirtySections(state).size).toBe(0);
    const reordered = wallDraftReducer(state, { type: 'devices', devices: ['kegtron_pro:b', 'kegtron_pro:a'] });
    expect(dirtySections(reordered).size).toBe(0);
  });

  it('marks the section an edit belongs to', () => {
    let state = start();
    state = wallDraftReducer(state, { type: 'patch', patch: { look: 'tally' } });
    state = wallDraftReducer(state, { type: 'meta', slug: 'bar' });
    state = wallDraftReducer(state, { type: 'devices', devices: ['kegtron_pro:a'] });
    expect([...dirtySections(state)].sort()).toEqual(['content', 'look', 'pages']);
  });

  it('reverting one section leaves the others drafted', () => {
    let state = start();
    state = wallDraftReducer(state, { type: 'patch', patch: { look: 'tally', customCss: 'a{}' } });
    state = wallDraftReducer(state, { type: 'revert', section: 'look' });
    expect(state.draft.form.look).toBe(state.saved.form.look);
    expect(state.draft.form.customCss).toBe('a{}');
    expect([...dirtySections(state)]).toEqual(['css']);
  });

  it('a save that missed the device write keeps the device change drafted', () => {
    let state = start();
    state = wallDraftReducer(state, { type: 'patch', patch: { look: 'zen' } });
    state = wallDraftReducer(state, { type: 'devices', devices: [] });
    state = wallDraftReducer(state, { type: 'saved', devices: false });
    expect([...dirtySections(state)]).toEqual(['pages']);
    state = wallDraftReducer(state, { type: 'saved', devices: true });
    expect(dirtySections(state).size).toBe(0);
  });

  it('a loaded device set is saved, not an edit', () => {
    const state = wallDraftReducer(
      initialWallDraft({ form: configToFormState(wallConfigSchema.parse({})), name: 'M', slug: 'm', devices: [] }),
      { type: 'devicesLoaded', devices: ['kegtron_pro:x'] },
    );
    expect(dirtySections(state).size).toBe(0);
  });
});
