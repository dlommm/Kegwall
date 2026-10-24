/**
 * One chart language for every admin chart (Kegwall 2.1 "i-module"): a faint grid, quiet
 * ticks, the cursor wash, and the rule that the marks are quiet except the one the sentence
 * talks about, which is copper (the busiest day, the hour that is now).
 */
export const GRID_STROKE = 'color-mix(in srgb, var(--text) 10%, transparent)';
export const CURSOR_FILL = 'color-mix(in srgb, var(--text) 6%, transparent)';
export const QUIET_MARK = 'color-mix(in srgb, var(--text) 26%, transparent)';
export const LEAD_MARK = 'var(--accent)';
export const TICK = { fill: 'var(--text-dim)', fontSize: 11 } as const;
