import type { FastifyInstance } from 'fastify';
import multipart, { type MultipartFile } from '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { requireRole } from './auth.js';

/** 5MB cap, shared with Task 4's `routes/lookup.ts` Untappd label download (which
 * bounds its own streamed read against this same constant — see that file). */
export const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Magic-byte sniffers for the three label formats we accept — deliberately NOT trusting
 * the multipart part's declared `Content-Type` header (any client can lie about that; see
 * the Task 1 brief). Order doesn't matter, only the first bytes of the buffer are read.
 */
const SIGNATURES: { ext: 'png' | 'jpg' | 'webp'; matches: (b: Buffer) => boolean }[] = [
  {
    ext: 'png',
    matches: (b) => b.length >= 8
      && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
      && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  { ext: 'jpg', matches: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    ext: 'webp',
    matches: (b) => b.length >= 12
      && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  },
];

/** Exported for `routes/lookup.ts`'s Untappd label import, which reuses the exact same
 * magic-byte sniffing on a server-downloaded buffer instead of a multipart upload. */
export function detectExt(buf: Buffer): string | null {
  return SIGNATURES.find((s) => s.matches(buf))?.ext ?? null;
}

/** Validates `buf` by magic bytes and, if it's a supported image, writes it to
 * `<labelsDir>/<uuid>.<ext>` and returns the `/labels/...` path the client should store as
 * `labelImage`. Returns `null` (writes nothing) for an unsupported/undetectable type.
 * Shared by this module's multipart upload handler and `routes/lookup.ts`'s Untappd
 * label-download handler — one place owns "what counts as a valid stored label". */
export function writeLabelFile(labelsDir: string, buf: Buffer): string | null {
  const ext = detectExt(buf);
  if (!ext) return null;
  const filename = `${randomUUID()}.${ext}`;
  writeFileSync(join(labelsDir, filename), buf);
  return `/labels/${filename}`;
}

/** `POST /api/uploads/label` — editor-role image upload used by the beers form (Task 4)
 * and, indirectly, Untappd label fetches (also Task 4, which downloads server-side into
 * this same directory rather than hotlinking). Kept as its own small route module so
 * `crud.ts` doesn't have to grow a multipart/file-storage concern. */
export async function uploadsRoutes(app: FastifyInstance, dataDir: string) {
  await app.register(multipart, { limits: { fileSize: MAX_BYTES, files: 1 } });

  const labelsDir = join(dataDir, 'labels');
  // Belt-and-suspenders: app.ts always registers labelsStaticRoutes (which also mkdir's
  // this) before this module, but a caller wiring uploadsRoutes independently shouldn't
  // 500 on a missing directory.
  mkdirSync(labelsDir, { recursive: true });

  app.post('/api/uploads/label', { preHandler: requireRole('editor') }, async (req, reply) => {
    let file: MultipartFile | undefined;
    try {
      file = await req.file();
    } catch {
      return reply.code(400).send({ error: 'validation', message: 'Expected a multipart/form-data upload' });
    }
    if (!file) {
      return reply.code(400).send({ error: 'validation', message: 'No file was uploaded' });
    }

    let buf: Buffer;
    try {
      buf = await file.toBuffer();
    } catch (err: any) {
      if (err?.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({ error: 'payload_too_large', message: 'File exceeds the 5MB limit' });
      }
      throw err;
    }

    const path = writeLabelFile(labelsDir, buf);
    if (!path) {
      return reply.code(400).send({
        error: 'validation',
        message: 'Unsupported file type — labels must be PNG, JPEG, or WebP',
      });
    }

    return reply.code(201).send({ path });
  });
}
