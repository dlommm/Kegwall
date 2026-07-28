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
});

export type WallConfig = z.infer<typeof wallConfigSchema>;
