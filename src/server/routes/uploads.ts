import type { FastifyInstance } from 'fastify';
import multipart, { type MultipartFile } from '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { requireRole } from './auth.js';

const MAX_BYTES = 5 * 1024 * 1024;

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

function detectExt(buf: Buffer): string | null {
  return SIGNATURES.find((s) => s.matches(buf))?.ext ?? null;
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

    const ext = detectExt(buf);
    if (!ext) {
      return reply.code(400).send({
        error: 'validation',
        message: 'Unsupported file type — labels must be PNG, JPEG, or WebP',
      });
    }

    const filename = `${randomUUID()}.${ext}`;
    writeFileSync(join(labelsDir, filename), buf);
    return reply.code(201).send({ path: `/labels/${filename}` });
  });
}
