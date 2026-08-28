import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Root-level vitest globalSetup: contain every test's temp dir in ONE per-run root that
 * teardown deletes.
 *
 * ~200 test files create per-test SQLite data dirs via `mkdtempSync(join(tmpdir(),
 * 'ktdash-'))` and never remove them — each run leaks a few hundred small dirs into the
 * OS tmpdir, forever. On a machine that runs the suite regularly this genuinely fills
 * the disk (observed 2026-08-28: 4,000+ leaked dirs totalling 2.3 GB on a 2.7 GB /tmp,
 * aborting test runs midway with ENOSPC writes that surface as inscrutable mass
 * failures).
 *
 * Rather than touching every call site, this redirects them all at once: `os.tmpdir()`
 * re-reads `process.env.TMPDIR` on every call (it is not cached), and this setup runs in
 * vitest's main process BEFORE any worker is spawned, so every worker inherits the
 * override and every `mkdtempSync(join(tmpdir(), ...))` lands inside the per-run root.
 * Teardown removes the root wholesale — including dirs whose SQLite handles a worker
 * still holds; by teardown all workers have exited.
 *
 * The root itself is created under the REAL OS tmpdir with its own unique name, so
 * concurrent vitest runs (e.g. parallel worktrees) never collide, and a crashed run
 * leaves exactly one dated dir to sweep rather than hundreds of anonymous ones.
 */
export default function globalTmpRoot(): () => void {
  const originalTmpdir = process.env.TMPDIR;
  const root = mkdtempSync(join(tmpdir(), 'kegwall-testrun-'));
  process.env.TMPDIR = root;
  return () => {
    if (originalTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = originalTmpdir;
    rmSync(root, { recursive: true, force: true });
  };
}
