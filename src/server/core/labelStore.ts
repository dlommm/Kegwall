import type Database from 'better-sqlite3';
import { readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Owns the on-disk lifecycle of uploaded/downloaded beer-label files
// (`<dataDir>/labels/<uuid>.<ext>`). Before this, nothing ever deleted a label file:
// replacing a beer's image or deleting the beer orphaned the old file, which stayed on
// disk (and publicly fetchable) forever — unbounded growth on the Pi's SD card, sharing a
// partition with app.db. This module deletes a label when it's no longer referenced, and
// sweeps orphans at boot. Every path check is anchored to the labels dir with a strict
// filename pattern, so nothing here can ever touch a file outside it.
// ---------------------------------------------------------------------------

/** The exact shape writeLabelFile emits: a v4 UUID plus one of the three allowed
 * extensions. Anything else in the labels dir (or any label_image value) is left alone. */
const LABEL_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg|webp)$/;

/** Returns the bare filename for a stored `/labels/<uuid>.<ext>` value, or null when the
 * value isn't a managed label path (an external URL, a legacy value, empty). Rejects any
 * value with extra path segments, so a crafted `label_image` can never escape the dir. */
export function labelFilename(labelPath: string | null | undefined): string | null {
  if (!labelPath) return null;
  const m = /^\/labels\/([^/]+)$/.exec(labelPath);
  if (!m) return null;
  return LABEL_FILE.test(m[1]!) ? m[1]! : null;
}

/** Deletes the file backing `labelPath` IF it is a managed label file AND no `beers` row
 * still references it. A no-op for external/legacy values or a still-referenced file.
 * Never throws — a missing file is fine. */
export function deleteLabelIfUnreferenced(
  db: Database.Database, labelsDir: string, labelPath: string | null | undefined,
): void {
  const name = labelFilename(labelPath);
  if (!name) return;
  const stillUsed = db.prepare('SELECT 1 FROM beers WHERE label_image = ? LIMIT 1').get(labelPath);
  if (stillUsed) return;
  try {
    unlinkSync(join(labelsDir, name));
  } catch { /* already gone — nothing to do */ }
}

/** Boot sweep: removes every file in `labelsDir` that no `beers.label_image` references.
 * Returns the count removed. Skips (never deletes) any file that isn't a managed label
 * name. A missing labels dir is a 0-count no-op (fresh install / test temp dir). */
export function sweepOrphanLabels(db: Database.Database, labelsDir: string): number {
  let files: string[];
  try {
    files = readdirSync(labelsDir);
  } catch {
    return 0;
  }
  const referenced = new Set(
    (db.prepare('SELECT label_image FROM beers WHERE label_image IS NOT NULL').all() as
      { label_image: string }[])
      .map((r) => labelFilename(r.label_image))
      .filter((n): n is string => n !== null),
  );
  let removed = 0;
  for (const f of files) {
    if (!LABEL_FILE.test(f)) continue; // never touch anything that isn't a managed label
    if (referenced.has(f)) continue;
    try {
      unlinkSync(join(labelsDir, f));
      removed += 1;
    } catch { /* raced with another delete — fine */ }
  }
  return removed;
}
