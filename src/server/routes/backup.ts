import type { FastifyInstance } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import {
  mkdtempSync, rmSync, createReadStream, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requireRole } from './auth.js';

/**
 * 50MB cap for a restored database upload — generous headroom over `routes/uploads.ts`'s
 * 5MB label cap since a real `app.db` (telemetry + pours history included) can run well
 * past a few MB. Passed as a PER-CALL override to `req.file()` (see the restore handler
 * below) rather than by registering `@fastify/multipart` again in this module: the plugin
 * is already registered once, by `routes/uploads.ts`, directly on this same (non-
 * encapsulated) app instance — a second `app.register(multipart, ...)` here would re-run
 * its `decorateRequest` calls and throw `FST_ERR_DEC_ALREADY_PRESENT`. `req.file(options)`
 * deep-merges its per-call `options.limits` over the plugin's registration-time defaults
 * (see `@fastify/multipart`'s `handleMultipart`), so this override applies cleanly without
 * touching the label endpoint's own 5MB limit.
 */
export const MAX_RESTORE_BYTES = 50 * 1024 * 1024;

/** SQLite's fixed 16-byte file-header magic string — every valid database file (WAL mode
 * or not) starts with this exact byte sequence (including the trailing NUL); see the
 * SQLite file format spec. Checked the same "never trust the declared Content-Type,
 * inspect the actual bytes" way `uploads.ts`'s `detectExt` validates label images. */
const SQLITE_MAGIC = 'SQLite format 3\0';

function hasSqliteMagic(buf: Buffer): boolean {
  return buf.length >= 16 && buf.toString('latin1', 0, 16) === SQLITE_MAGIC;
}

/**
 * `GET /api/admin/backup` / `POST /api/admin/restore` (Task 8, admin role only).
 *
 * Backup uses better-sqlite3's own `db.backup()` — SQLite's online backup API, safe to
 * run against a live, concurrently-written WAL database (unlike a raw file copy, which
 * could grab a torn/inconsistent snapshot mid-write) — to stage a consistent snapshot in
 * a throwaway temp dir, then streams it down and deletes the temp dir once the response
 * has finished sending.
 *
 * Restore never touches the live, already-open `app.db` — swapping the file out from
 * under an open `Database` handle and its prepared statements admissions mid-process
 * would corrupt state. Instead it validates and stages the upload as
 * `DATA_DIR/pending-restore.db`; the swap itself happens once, atomically, at the very
 * start of the NEXT boot — see `db/db.ts`'s `applyPendingRestore`.
 */
export async function backupRoutes(app: FastifyInstance, dataDir: string) {
  const admin = { preHandler: requireRole('admin') };

  app.get('/api/admin/backup', admin, async (req, reply) => {
    const stagingDir = mkdtempSync(join(tmpdir(), 'ktdash-backup-'));
    const stagingPath = join(stagingDir, 'backup.db');
    try {
      await app.ctx.db.backup(stagingPath);
    } catch (err) {
      rmSync(stagingDir, { recursive: true, force: true });
      throw err;
    }

    const date = new Date().toISOString().slice(0, 10);
    reply
      .header('content-type', 'application/octet-stream')
      .header('content-disposition', `attachment; filename="kegwall-backup-${date}.db"`);

    const stream = createReadStream(stagingPath);
    const cleanup = () => rmSync(stagingDir, { recursive: true, force: true });
    stream.once('close', cleanup);
    stream.once('error', cleanup);
    return reply.send(stream);
  });

  app.post('/api/admin/restore', admin, async (req, reply) => {
    let file: MultipartFile | undefined;
    try {
      file = await req.file({ limits: { fileSize: MAX_RESTORE_BYTES, files: 1 } });
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
        return reply.code(413).send({ error: 'payload_too_large', message: 'File exceeds the 50MB limit' });
      }
      throw err;
    }

    if (!hasSqliteMagic(buf)) {
      return reply.code(400).send({
        error: 'validation',
        message: "That file doesn't look like a SQLite database (bad header)",
      });
    }

    writeFileSync(join(dataDir, 'pending-restore.db'), buf);
    return reply.send({
      ok: true,
      message: 'Restore staged. Restart the server to apply it — this replaces all current data.',
    });
  });
}
