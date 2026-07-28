import { describe, it, expect } from 'vitest';
import { renderTemplate } from '../../src/server/notify/template.js';

// Phase 5 Task 2: {{path.to.value}} dot-path substitution used by notify/webhook/mqtt
// action bodies. Deliberately NO code eval (no `new Function`/`eval`) and NO
// prototype-chain traversal (own-properties only) -- see the "prototype pollution
// attempts" cases below, which must always render '' rather than reaching into
// Object.prototype (e.g. via `{{constructor.name}}` -> "Object").

describe('renderTemplate', () => {
  it('substitutes a top-level path', () => {
    expect(renderTemplate('Tap {{tap.number}} poured', { tap: { number: 3 } })).toBe('Tap 3 poured');
  });

  it('substitutes a nested path', () => {
    expect(renderTemplate('{{beer.brewery.name}}', { beer: { brewery: { name: 'Modern Brew Co' } } }))
      .toBe('Modern Brew Co');
  });

  it('substitutes multiple placeholders in one string', () => {
    expect(renderTemplate('{{beer.name}} on tap {{tap.number}}: {{pour.volume_ml}}mL', {
      beer: { name: 'Citra IPA' }, tap: { number: 2 }, pour: { volume_ml: 355 },
    })).toBe('Citra IPA on tap 2: 355mL');
  });

  it('renders numbers and booleans as strings', () => {
    expect(renderTemplate('{{keg.level_pct}} / {{alert.active}}', { keg: { level_pct: 42.5 }, alert: { active: true } }))
      .toBe('42.5 / true');
  });

  it('renders a missing top-level key as empty string', () => {
    expect(renderTemplate('[{{monitor.temp}}]', {})).toBe('[]');
  });

  it('renders a missing nested key as empty string', () => {
    expect(renderTemplate('[{{beer.brewery.name}}]', { beer: {} })).toBe('[]');
  });

  it('renders a path through a null intermediate as empty string', () => {
    expect(renderTemplate('[{{beer.brewery.name}}]', { beer: { brewery: null } })).toBe('[]');
  });

  it('renders null/undefined leaf values as empty string', () => {
    expect(renderTemplate('[{{tap.number}}]', { tap: { number: null } })).toBe('[]');
    expect(renderTemplate('[{{tap.number}}]', { tap: { number: undefined } })).toBe('[]');
  });

  it('leaves non-template text untouched', () => {
    expect(renderTemplate('Just plain text, no braces here.', {})).toBe('Just plain text, no braces here.');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(renderTemplate('{{ tap.number }}', { tap: { number: 7 } })).toBe('7');
  });

  it('never evaluates code -- a JS-expression-shaped placeholder is left untouched, not executed', () => {
    // A path with parens/operators doesn't match the dot-path token grammar at all, so
    // it's left as literal, un-substituted text -- proof this never reaches eval/new
    // Function (which would either execute the thrown Error or itself throw a
    // SyntaxError/ReferenceError instead of returning cleanly).
    const input = '{{ (function(){throw new Error("boom")})() }}';
    expect(renderTemplate(input, {})).toBe(input);
  });

  it('does not resolve __proto__ (prototype-chain traversal blocked)', () => {
    expect(renderTemplate('[{{beer.__proto__}}]', { beer: { name: 'x' } })).toBe('[]');
  });

  it('does not resolve constructor (a classic prototype-pollution probe)', () => {
    expect(renderTemplate('[{{beer.constructor.name}}]', { beer: { name: 'x' } })).toBe('[]');
    expect(renderTemplate('[{{constructor.name}}]', {})).toBe('[]');
  });

  it('does not resolve inherited Object.prototype members like toString/hasOwnProperty', () => {
    expect(renderTemplate('[{{beer.toString}}]', { beer: { name: 'x' } })).toBe('[]');
    expect(renderTemplate('[{{beer.hasOwnProperty}}]', { beer: { name: 'x' } })).toBe('[]');
  });

  it('does not let __proto__.polluted leak in from a prior pollution attempt', () => {
    // Sanity check that even if some other code in the process polluted
    // Object.prototype, renderTemplate's own-properties-only walk would not surface it.
    (Object.prototype as any).__polluted_probe__ = 'leaked';
    try {
      expect(renderTemplate('[{{beer.__polluted_probe__}}]', { beer: { name: 'x' } })).toBe('[]');
    } finally {
      delete (Object.prototype as any).__polluted_probe__;
    }
  });

  it('renders object/array leaf values as empty string rather than [object Object]', () => {
    expect(renderTemplate('[{{beer.brewery}}]', { beer: { brewery: { name: 'x' } } })).toBe('[]');
  });

  it('handles an empty ctx for every top-level key the spec documents', () => {
    const tpl = '{{beer.name}}|{{tap.number}}|{{keg.level_pct}}|{{pour.volume_ml}}|{{monitor.temp}}|{{alert.severity}}';
    expect(renderTemplate(tpl, {})).toBe('|||||');
  });
});
