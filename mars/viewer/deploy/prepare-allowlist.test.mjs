// Release-allowlist gate: every static asset URL the app or engine references must be
// staged by deploy/prepare.py, so a new asset fails `npm test` locally instead of
// 404ing in production (engine/ and engine/takes/ each shipped missing once).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const NAMESPACES = ['engine', 'modular', 'browser', 'data', 'history', '2020'];
const NS = NAMESPACES.join('|');
// '…' / "…" literals, and `…` template literals whose ${…} parts become one-segment wildcards
const QUOTED = new RegExp(`(['"])(/(?:${NS})/[^'"\\s]*)\\1`, 'g');
const TEMPLATE = new RegExp('`(/(?:' + NS + ')/[^`\\s]*)`', 'g');
const HOLE = '\u0000';

function walk(dir, keep, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') walk(p, keep, out);
    } else if (keep(e.name)) out.push(p);
  }
  return out;
}

function references() {
  const files = [
    ...walk(path.join(ROOT, 'app'), (n) => /\.tsx?$/.test(n)),
    ...walk(path.join(ROOT, 'engine'), (n) => n.endsWith('.ts')),
  ];
  const refs = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const where = (i) => `${path.relative(ROOT, file)}:${src.slice(0, i).split('\n').length}`;
    for (const m of src.matchAll(QUOTED)) refs.push({ url: m[2], at: where(m.index) });
    for (const m of src.matchAll(TEMPLATE))
      refs.push({ url: m[1].replace(/\$\{[^}]*\}/g, HOLE), at: where(m.index) });
  }
  return refs.map((r) => ({ ...r, url: r.url.replace(/[?#].*$/, '') }));
}

const segRegex = (seg) =>
  new RegExp('^' + seg.split(HOLE).map((s) => s.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&')).join('[^/]+') + '$');

/** Existing public/ files a templated URL can resolve to (follows the modular/data symlinks). */
function expand(url) {
  let dirs = [''];
  const segs = url.slice(1).split('/');
  segs.forEach((seg, i) => {
    const last = i === segs.length - 1;
    const next = [];
    for (const d of dirs) {
      const abs = path.join(PUBLIC, d);
      let names;
      try {
        names = seg.includes(HOLE) ? readdirSync(abs).filter((n) => segRegex(seg).test(n)) : [seg];
      } catch {
        continue;
      }
      for (const n of names) {
        const rel = d ? `${d}/${n}` : n;
        try {
          const st = statSync(path.join(PUBLIC, rel));
          if (last ? st.isFile() : st.isDirectory()) next.push(rel);
        } catch {}
      }
    }
    dirs = next;
  });
  return dirs;
}

const release = JSON.parse(execFileSync('python3', ['deploy/prepare.py', '--list'], { cwd: ROOT, encoding: 'utf8' }));
const staged = new Set(release.files);

test('the scanner sees the known asset references (guards against a silently broken regex)', () => {
  const urls = new Set(references().map((r) => r.url));
  for (const known of ['/engine/takes/manifest.json', '/engine/campus-2026.json', '/data/manifest.json'])
    assert.ok(urls.has(known), `scanner missed ${known}`);
  assert.ok(urls.size >= 15, `only ${urls.size} asset URLs found`);
});

test('engine/** is a directory rule, so new engine assets ship without editing prepare.py', () => {
  assert.ok(release.globs.includes('engine/**'), 'engine/** glob missing from deploy/prepare.py GLOBS');
  for (const f of walk(path.join(PUBLIC, 'engine'), (n) => !n.startsWith('.')))
    assert.ok(staged.has(path.relative(PUBLIC, f).split(path.sep).join('/')), `${f} not staged`);
});

test('every /engine|modular|browser|data|history|2020/ URL in app/ and engine/ is staged by deploy/prepare.py', () => {
  const problems = [];
  for (const { url, at } of references()) {
    if (!url.includes(HOLE)) {
      if (!staged.has(url.slice(1))) problems.push(`${at} ${url} is not in the release allowlist`);
      continue;
    }
    const shown = url.replaceAll(HOLE, '${…}');
    const hits = expand(url);
    if (!hits.length) problems.push(`${at} ${shown} matches no file under public/`);
    for (const h of hits) if (!staged.has(h)) problems.push(`${at} ${shown} can resolve to /${h}, which is not staged`);
  }
  assert.deepEqual(problems, [], 'add the file to FILES or a GLOBS rule in deploy/prepare.py:\n' + problems.join('\n'));
});
