import { z } from 'zod';

export const wallConfigSchema = z.object({
  columns: z.number().int().min(1).max(6).default(2),
  cardTemplate: z.enum(['full', 'standard', 'compact', 'minimal']).default('standard'),
  theme: z.object({
    id: z.string().default('taproom'),
    overrides: z.record(z.string(), z.string()).optional(),
  }).default({ id: 'taproom' }),
  pages: z.array(z.object({ tapIds: z.array(z.number().int()) })).default([]),
  rotationSeconds: z.number().int().min(3).default(15),
  transition: z.enum(['crossfade', 'slide', 'none']).default('crossfade'),
  showQr: z.boolean().default(false),
  header: z.object({
    title: z.string().optional(),
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
