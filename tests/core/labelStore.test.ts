import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDb } from '../../src/server/db/db.js';
import { createBeer } from '../../src/server/db/beers.js';
import {
  labelFilename, deleteLabelIfUnreferenced, sweepOrphanLabels,
} from '../../src/server/core/labelStore.js';

const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

let db: Database.Database;
let dataDir: string;
let labelsDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'ktdash-'));
  db = openDb(dataDir);
  labelsDir = join(dataDir, 'labels');
  // openDb doesn't create the labels dir; create it for the file ops.
  writeFileSync(join(dataDir, '.keep'), ''); // ensure dataDir exists (mkdtemp already did)
});

function makeLabel(name: string): void {
  mkdirSync(labelsDir, { recursive: true });
  writeFileSync(join(labelsDir, name), 'x');
}

describe('labelFilename', () => {
  it('accepts a managed /labels/<uuid>.<ext> path', () => {
    expect(labelFilename(`/labels/${UUID}.png`)).toBe(`${UUID}.png`);
    expect(labelFilename(`/labels/${UUID}.jpg`)).toBe(`${UUID}.jpg`);
    expect(labelFilename(`/labels/${UUID}.webp`)).toBe(`${UUID}.webp`);
  });

  it('rejects external URLs, legacy values, traversal, and empties', () => {
    expect(labelFilename(null)).toBeNull();
    expect(labelFilename('')).toBeNull();
    expect(labelFilename('https://evil.example/x.png')).toBeNull();
    expect(labelFilename(`/labels/../../etc/passwd`)).toBeNull();
    expect(labelFilename(`/labels/${UUID}.gif`)).toBeNull(); // wrong ext
    expect(labelFilename(`/labels/not-a-uuid.png`)).toBeNull();
  });
});

describe('deleteLabelIfUnreferenced', () => {
  it('deletes a managed file no beer references', () => {
    makeLabel(`${UUID}.png`);
    deleteLabelIfUnreferenced(db, labelsDir, `/labels/${UUID}.png`);
    expect(existsSync(join(labelsDir, `${UUID}.png`))).toBe(false);
  });

  it('keeps a file still referenced by a beer', () => {
    makeLabel(`${UUID}.png`);
    createBeer(db, { name: 'Citra', labelImage: `/labels/${UUID}.png` });
    deleteLabelIfUnreferenced(db, labelsDir, `/labels/${UUID}.png`);
    expect(existsSync(join(labelsDir, `${UUID}.png`))).toBe(true);
  });

  it('ignores external/legacy values (never throws)', () => {
    expect(() => deleteLabelIfUnreferenced(db, labelsDir, 'https://cdn.example/x.png')).not.toThrow();
    expect(() => deleteLabelIfUnreferenced(db, labelsDir, null)).not.toThrow();
  });
});

describe('sweepOrphanLabels', () => {
  it('removes only unreferenced managed label files', () => {
    const referenced = 'aaaaaaaa-1111-2222-3333-444444444444.png';
    const orphan = 'bbbbbbbb-1111-2222-3333-444444444444.jpg';
    makeLabel(referenced);
    makeLabel(orphan);
    makeLabel('not-a-label.txt'); // must be left untouched
    createBeer(db, { name: 'Ref', labelImage: `/labels/${referenced}` });

    const removed = sweepOrphanLabels(db, labelsDir);
    expect(removed).toBe(1);
    expect(existsSync(join(labelsDir, referenced))).toBe(true);
    expect(existsSync(join(labelsDir, orphan))).toBe(false);
    expect(existsSync(join(labelsDir, 'not-a-label.txt'))).toBe(true);
  });

  it('is a 0-count no-op when the labels dir does not exist', () => {
    expect(sweepOrphanLabels(db, join(dataDir, 'nope'))).toBe(0);
  });
});
