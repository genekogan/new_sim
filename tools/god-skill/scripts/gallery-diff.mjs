#!/usr/bin/env node
// Pixel + triangle gate. Run gallery.mjs before editing, then --compare <before-dir> after.
// Intentional differences require {"def-name": "reason"} (or "def-name/phase") in --allow JSON.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function compareGalleries(beforeDir, afterDir, { allow = {} } = {}) {
  const read = dir => JSON.parse(readFileSync(resolve(dir, 'gallery.json'), 'utf8'));
  const before = read(beforeDir), after = read(afterDir);
  if (before.schema !== 'kit-gallery/1' || after.schema !== 'kit-gallery/1') throw new Error('gallery captures missing; render both with current gallery.mjs');
  const key = c => `${c.name}/${c.phase}`;
  const b = new Map(before.captures.map(c => [key(c), c])), a = new Map(after.captures.map(c => [key(c), c]));
  const defs = [...new Set([...b.keys(), ...a.keys()])].sort().map(id => {
    const x = b.get(id), y = a.get(id);
    const row = { id, beforeTris: x?.tris ?? null, afterTris: y?.tris ?? null, triangleDelta: x && y ? y.tris - x.tris : null, changedPixels: 0, maxChannelDelta: 0, reason: allow[id] ?? allow[y?.name ?? x?.name] ?? null };
    if (!x || !y) return { ...row, changed: true, status: x ? 'removed' : 'added' };
    if (x.width !== y.width || x.height !== y.height) return { ...row, changed: true, status: 'size-changed' };
    const p = readFileSync(resolve(beforeDir, x.file)), q = readFileSync(resolve(afterDir, y.file));
    if (p.length !== x.width * x.height * 4 || q.length !== p.length) throw new Error(`invalid pixel capture: ${id}`);
    for (let i = 0; i < p.length; i += 4) {
      let delta = 0;
      for (let k = 0; k < 4; k++) delta = Math.max(delta, Math.abs(p[i + k] - q[i + k]));
      if (delta) row.changedPixels++;
      row.maxChannelDelta = Math.max(row.maxChannelDelta, delta);
    }
    return { ...row, pixelPercent: row.changedPixels * 100 / (x.width * x.height), changed: row.changedPixels > 0 || row.triangleDelta !== 0, status: 'compared' };
  });
  const changed = defs.filter(d => d.changed), unjustified = changed.filter(d => typeof d.reason !== 'string' || !d.reason.trim());
  const errors = [...before.errors, ...after.errors];
  return { schema: 'kit-gallery-diff/1', before: resolve(beforeDir), after: resolve(afterDir), ok: unjustified.length === 0 && errors.length === 0 && defs.length > 0, defs, changed, unjustified, errors };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [before, after, allowPath] = process.argv.slice(2);
  if (!before || !after) throw new Error('usage: gallery-diff.mjs <before-dir> <after-dir> [allow-reasons.json]');
  const diff = compareGalleries(before, after, { allow: allowPath ? JSON.parse(readFileSync(allowPath, 'utf8')) : {} });
  writeFileSync(resolve(after, 'diff.json'), JSON.stringify(diff, null, 2) + '\n');
  for (const d of diff.changed) console.log(`${d.id}: ${d.changedPixels} pixels; tris ${d.beforeTris} → ${d.afterTris}; ${d.reason ?? 'UNJUSTIFIED'}`);
  console.log(`${diff.ok ? 'PASS' : 'FAIL'}: ${diff.changed.length}/${diff.defs.length} changed, ${diff.unjustified.length} unjustified, ${diff.errors.length} errors`);
  process.exitCode = diff.ok ? 0 : 1;
}
