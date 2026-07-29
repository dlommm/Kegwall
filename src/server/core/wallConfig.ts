import { z } from 'zod';

export const wallConfigSchema = z.object({
  columns: z.number().int().min(1).max(6).default(2),
  // Wall LOOK (Pour Wall overhaul): the layout template axis, separate from `theme`
  // (colors/fonts) and `cardTemplate` (which only applies to the 'classic' grid look).
  // 'classic' is the pre-overhaul WallGrid/TapCard wall, and stays the default so
  // existing walls' stored config (parsed with this key absent) render unchanged.
  look: z.enum(['classic', 'ledger', 'gallery', 'columns']).default('classic'),
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
    overrides: z.record(z.string(), z.string()).optional(),
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
  // Keg-asset fill indicator feature: per-wall display style for a tap's fill visual.
  // 'liquid' (default) is the existing SRM-true LiquidFill; 'keg' renders KegFill's
  // photorealistic cutaway-keg cavity with a traffic-light level color instead. Default
  // 'liquid' so existing walls' stored config (parsed with this key absent) render
  // exactly as before. Applies to the full/standard/minimal card templates only —
  // `compact`'s tiny liquid swatch keeps the liquid swatch regardless (see TapCard.tsx).
  fillStyle: z.enum(['liquid', 'keg']).default('liquid'),
});

export type WallConfig = z.infer<typeof wallConfigSchema>;
