import { describe, it, expect } from 'vitest';
import { findDeadRules } from '../../scripts/css-usage';

// Kegwall V2 M11: no stylesheet keeps a rule for a class nothing renders any more. Fix a
// failure with `npm run lint:css -- --fix` (or delete the rule by hand).
describe('plain stylesheets', () => {
  it('have no rules for classes the web source never uses', () => {
    const dead = findDeadRules().map((d) => `${d.file}:${d.line} ${d.selector}`);
    expect(dead).toEqual([]);
  });
});
