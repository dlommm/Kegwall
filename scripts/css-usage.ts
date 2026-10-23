/**
 * Unused-selector check for the plain (non-module) stylesheets under src/web (Kegwall V2 M11).
 * A class counts as used when its name appears anywhere in the web source, or when it starts
 * with a prefix the source builds at runtime (`game-tag--${kind}` keeps every `game-tag--*`).
 * A rule is dead when every one of its selectors names at least one unused class.
 *
 *   npx tsx scripts/css-usage.ts          # list dead rules, exit 1 if any
 *   npx tsx scripts/css-usage.ts --fix    # delete them in place
 *
 * tests/web/cssUsage.test.ts runs the same check, so CI fails on a dead selector.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import postcss, { type Rule } from 'postcss';

const ROOT = join(import.meta.dirname, '..');
const WEB = join(ROOT, 'src/web');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

export interface DeadRule {
  file: string;
  line: number;
  selector: string;
  unused: string[];
}

/** Plain stylesheets the check covers: every `.css` under src/web except CSS Modules. */
export function plainStylesheets(): string[] {
  return walk(WEB).filter((f) => f.endsWith('.css') && !f.endsWith('.module.css'));
}

function sourceText(): { text: string; prefixes: string[] } {
  const files = walk(WEB).filter((f) => /\.(tsx?|html)$/.test(f));
  const text = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  // `foo--${x}` / `foo__${x}` / "foo-" + x: class names assembled at runtime.
  const prefixes = new Set<string>();
  for (const m of text.matchAll(/([A-Za-z][\w-]*(?:-|__))\$\{/g)) prefixes.add(m[1]!);
  for (const m of text.matchAll(/['"`]([A-Za-z][\w-]*(?:-|__))['"`]\s*\+/g)) prefixes.add(m[1]!);
  return { text, prefixes: [...prefixes] };
}

function classesIn(selector: string): string[] {
  // Drop attribute selectors and :not()/:is() contents' strings before matching classes.
  const bare = selector.replace(/\[[^\]]*\]/g, '');
  return [...bare.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]!);
}

export function findDeadRules(files = plainStylesheets()): DeadRule[] {
  const { text, prefixes } = sourceText();
  const usedCache = new Map<string, boolean>();
  const used = (cls: string) => {
    let hit = usedCache.get(cls);
    if (hit === undefined) {
      hit = new RegExp(`(^|[^\\w-])${cls.replace(/[-]/g, '\\-')}($|[^\\w-])`).test(text)
        || prefixes.some((p) => cls.startsWith(p));
      usedCache.set(cls, hit);
    }
    return hit;
  };
  const dead: DeadRule[] = [];
  for (const file of files) {
    const root = postcss.parse(readFileSync(file, 'utf8'), { from: file });
    root.walkRules((rule: Rule) => {
      if (rule.parent?.type === 'atrule' && /keyframes/i.test((rule.parent as { name: string }).name)) return;
      const unusedPerSelector = rule.selectors.map((sel) => classesIn(sel).filter((c) => !used(c)));
      if (unusedPerSelector.length > 0 && unusedPerSelector.every((u) => u.length > 0)) {
        dead.push({
          file: relative(ROOT, file),
          line: rule.source?.start?.line ?? 0,
          selector: rule.selector.replace(/\s+/g, ' '),
          unused: [...new Set(unusedPerSelector.flat())],
        });
      }
    });
  }
  return dead;
}

/**
 * Comments that describe nothing any more: a comment followed by another comment (its section
 * emptied out) or by nothing at all. A file's first and last comments are kept (header, footnote).
 */
export function pruneOrphanComments(root: postcss.Root): number {
  let removed = 0;
  root.walkComments((c) => {
    if (c.parent === root && (root.first === c || root.last === c)) return;
    const next = c.next();
    if (!next || next.type === 'comment') {
      c.remove();
      removed += 1;
    }
  });
  return removed;
}

/** Removes dead rules (and any at-rule left empty, and comments left orphaned) in place. */
export function removeDeadRules(files = plainStylesheets()): number {
  const dead = findDeadRules(files);
  for (const file of files) {
    const rel = relative(ROOT, file);
    const lines = new Set(dead.filter((d) => d.file === rel).map((d) => d.line));
    const root = postcss.parse(readFileSync(file, 'utf8'), { from: file });
    root.walkRules((rule) => {
      if (lines.has(rule.source?.start?.line ?? -1)) rule.remove();
    });
    root.walkAtRules((at) => {
      if (at.nodes && at.nodes.length === 0) at.remove();
    });
    const comments = pruneOrphanComments(root);
    if (lines.size > 0 || comments > 0) writeFileSync(file, root.toString().replace(/\n{3,}/g, '\n\n'));
  }
  return dead.length;
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  if (process.argv.includes('--fix')) {
    console.log(`Removed ${removeDeadRules()} unused rules.`);
  } else {
    const dead = findDeadRules();
    for (const d of dead) console.log(`${d.file}:${d.line}  ${d.selector}  (unused: ${d.unused.join(', ')})`);
    console.log(dead.length === 0 ? 'No unused selectors.' : `${dead.length} unused rules.`);
    process.exitCode = dead.length === 0 ? 0 : 1;
  }
}
