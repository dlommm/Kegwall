import { z } from 'zod';

export const wallConfigSchema = z.object({
  columns: z.number().int().min(1).max(6).default(2),
  // Wall LOOK (Pour Wall overhaul): the layout template axis, separate from `theme`
  // (colors/fonts) and `cardTemplate` (which only applies to the 'classic' grid look).
  // 'classic' is the pre-overhaul WallGrid/TapCard wall, and stays the default so
  // existing walls' stored config (parsed with this key absent) render unchanged.
  look: z.enum([
    'classic', 'ledger', 'gallery', 'columns',
    'chalkboard', 'editorial', 'neon', 'terminal', 'poster', 'departures', 'zen',
  ]).default('classic'),
  // Glyph treatment for the looks' dynamic data glyphs (design 1d).
  glyphMode: z.enum(['flat', 'outline', 'duotone']).default('flat'),
  // Pour takeover (design turns 2 + 9): how the wall reacts to a live pour.
  // 'off' preserves pre-overhaul behavior (badges/glow only) for stored configs;
  // the five styles are per the design: full (2a), spotlight (2b), split (9a),
  // dock (9b), fill (9c). `minMl` is the trigger threshold — a pour only takes
  // over once its live counter passes this volume, so tiny foam blips don't
  // flash the screen (default ~2 oz).
  takeover: z.object({
    style: z.enum(['off', 'full', 'spotlight', 'split', 'dock', 'fill']).default('off'),
    minMl: z.number().min(0).default(60),
  }).default({ style: 'off', minMl: 60 }),
  // View rotation (design 4a/4b): the TV cycles a playlist of views, each with
  // its own seconds + on/off. Off by default so stored configs keep showing the
  // plain wall. A live pour always interrupts (the wall view returns while any
  // tap pours; overlay takeovers stack on top regardless). Playlist bar at the
  // bottom shows position while rotating.
  viewRotation: z.object({
    enabled: z.boolean().default(false),
    views: z.array(z.object({
      kind: z.enum(['wall', 'leaderboard']),
      seconds: z.number().int().min(3).max(600).default(15),
      enabled: z.boolean().default(true),
    })).default([
      { kind: 'wall', seconds: 15, enabled: true },
      { kind: 'leaderboard', seconds: 10, enabled: true },
    ]),
  }).default({
    enabled: false,
    views: [
      { kind: 'wall', seconds: 15, enabled: true },
      { kind: 'leaderboard', seconds: 10, enabled: true },
    ],
  }),
  cardTemplate: z.enum(['full', 'standard', 'compact', 'minimal']).default('standard'),
  theme: z.object({
    // 'midnight-slate' is the overhaul's flagship theme; existing walls all carry an
    // explicit stored id, so changing the default only affects newly created walls.
    id: z.string().default('midnight-slate'),
    // Per-token CSS custom-property overrides. Keys must be real `--custom-property` names
    // and values may not carry CSS structural chars (`;`, `{`, `}`, `<`) — these interpolate
    // raw into a <style> body (ThemeProvider.tsx), so an unconstrained value could inject
    // arbitrary rules onto the public wall. (Not XSS — <style> textContent isn't HTML-parsed
    // — but a defacement/exfil vector nonetheless. Raw `customCss` stays intentionally open.)
    overrides: z.record(
      z.string().regex(/^--[A-Za-z0-9_-]+$/),
      z.string().max(200).refine((v) => !/[;{}<]/.test(v) && !/[\u0000-\u001f\u007f]/.test(v), {
        message: "CSS token value must not contain ; { } < or control characters",
      }),
    ).optional(),
  }).default({ id: 'midnight-slate' }),
  pages: z.array(z.object({ tapIds: z.array(z.number().int()) })).default([]),
  rotationSeconds: z.number().int().min(3).default(15),
  transition: z.enum(['crossfade', 'slide', 'none']).default('crossfade'),
  showQr: z.boolean().default(false),
  header: z.object({
    title: z.string().optional(),
    // One-line announcement under the title (Ledger/Gallery headers) — distinct from
    // `ticker`, which scrolls in the looks' footer marquee.
    subtitle: z.string().optional(),
    showClock: z.boolean().default(false),
    showTemp: z.boolean().default(false),
  }).default({ showClock: false, showTemp: false }),
  ticker: z.string().optional(),
  fields: z.record(z.string(), z.boolean()).default({}),
  customCss: z.string().optional(),
  // ScreenCare (Task 5): OLED-friendly idle mode — dimmed logo + rotating tap highlight,
  // engaged `startAfterMinutes` after the wall mounts. Off by default so existing walls'
  // stored config (parsed with this key absent) keep their current behavior unchanged.
  screensaver: z.object({
    enabled: z.boolean().default(false),
    startAfterMinutes: z.number().int().min(1).default(10),
  }).default({ enabled: false, startAfterMinutes: 10 }),
  // Server-health strip (Pi monitoring epic): CPU/RAM/disk (+temp/watts when the
  // host reports them) in the wall's corner, fed live by the /ws host_stats frame.
  // Off by default so existing walls render unchanged.
  showHostStats: z.boolean().default(false),
  // Keg-asset fill indicator feature: per-wall display style for a tap's fill visual.
  // 'liquid' (default) is the existing SRM-true LiquidFill; 'keg' renders KegFill's
  // photorealistic cutaway-keg cavity with a traffic-light level color instead. Default
  // 'liquid' so existing walls' stored config (parsed with this key absent) render
  // exactly as before. Applies to the full/standard/minimal card templates only —
  // `compact`'s tiny liquid swatch keeps the liquid swatch regardless (see TapCard.tsx).
  fillStyle: z.enum(['liquid', 'keg']).default('liquid'),
  // Presence & display power (2026-07-31 spec, Part A): per-wall idle timers. Both
  // measure from the last activity. null = that stage never engages. Replaces the
  // legacy `screensaver` key above as the read path (see parseWallConfig below) —
  // `screensaver` stays in the schema only so stored configs round-trip unchanged.
  displayPower: z.object({
    screensaverAfterMinutes: z.number().int().min(1).nullable().default(null),
    offAfterMinutes: z.number().int().min(2).nullable().default(null),
    // Browser camera motion detection on the tablet page (frame differencing, no ML).
    cameraMotion: z.boolean().default(false),
  }).default({ screensaverAfterMinutes: null, offAfterMinutes: null, cameraMotion: false }),
}).superRefine((c, ctx) => {
  const { screensaverAfterMinutes: saver, offAfterMinutes: off } = c.displayPower;
  if (saver !== null && off !== null && off <= saver) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['displayPower', 'offAfterMinutes'],
      message: 'offAfterMinutes must be greater than screensaverAfterMinutes',
    });
  }
});

export type WallConfig = z.infer<typeof wallConfigSchema>;

/** The one correct way to parse STORED wall config JSON: applies the legacy
 * `screensaver` → `displayPower` mapping (enabled screensaver becomes
 * `screensaverAfterMinutes`) before schema parse, but only when the stored JSON
 * has no `displayPower` of its own — an explicit `displayPower` always wins. */
export function parseWallConfig(raw: unknown): WallConfig {
  const obj = (raw && typeof raw === 'object') ? { ...(raw as Record<string, unknown>) } : {};
  const legacy = obj.screensaver as { enabled?: boolean; startAfterMinutes?: number } | undefined;
  if (obj.displayPower === undefined && legacy?.enabled && typeof legacy.startAfterMinutes === 'number') {
    obj.displayPower = { screensaverAfterMinutes: legacy.startAfterMinutes };
  }
  return wallConfigSchema.parse(obj);
}
