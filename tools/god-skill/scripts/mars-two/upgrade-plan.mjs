#!/usr/bin/env node
// (FURN; renamed upgrade-plan.mjs in the MARSLAND merge: it diffs two TEMPLATES, incl. def version changes @1→@2. The live-world
// upgrade that reads a world snapshot and turns its own additions with the campus is upgrade.mjs.)
// Bring a world made from an older mars-two template up to the current one, as god ops (the world's history stays).
//
//   node --experimental-strip-types tools/god-skill/scripts/mars-two/upgrade-plan.mjs <git-ref-or-file of the old template> [out.json]
//   e.g. … upgrade-plan.mjs e6613f11 worlds/templates/mars-two-upgrade-e6613f11.json   (Gene's my-mars-college-2026)
//
// Things are matched by their path (parent/…/name) in the two templates:
// - a thing whose def changed (a new def version, e.g. core/mars-chiba@1 → @2) is removed and placed again; a building's
//   rooms go with it (remove cascades), so everything the new template puts inside it is placed again after it;
// - a thing only the new template has is placed; one only the old template has is removed;
// - a thing that only moved is moved.
// Anything the world's owner added inside a building that is replaced goes with it (the report lists those buildings).
// The script checks itself: old genesis + upgrade must give exactly the entities the new template gives.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './v3.mjs';

const [from, out] = process.argv.slice(2);
if (!from) { console.error('usage: upgrade.mjs <git-ref|template.json> [out.json]'); process.exit(2); }
const TPL = 'worlds/templates/mars-two.json';
const OLD = JSON.parse(existsSync(from) ? readFileSync(from, 'utf8') : execFileSync('git', ['-C', ROOT, 'show', `${from}:${TPL}`]).toString());
const NEW = JSON.parse(readFileSync(join(ROOT, TPL), 'utf8'));

const flat = (T) => { const ops = T.batches.flatMap((b) => b.ops.filter((o) => o.op === 'place')); const m = new Map(); for (const o of ops) m.set(o.in?.parent && o.in.parent !== 'world' ? `${o.in.parent}/${o.name}` : o.name, o); return m; };
const A = flat(OLD), B = flat(NEW);
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const under = (path, root) => path === root || path.startsWith(`${root}/`);

const replaced = [...B.keys()].filter((k) => A.has(k) && A.get(k).def !== B.get(k).def);
// a replaced thing takes its subtree with it
const gone = new Set([...A.keys()].filter((k) => replaced.some((r) => under(k, r)) || !B.has(k)));
const ops = [];
for (const k of [...A.keys()].filter((k) => !B.has(k) && !replaced.some((r) => under(k, r)))) ops.push({ op: 'remove', id: k, cascade: true });
for (const r of replaced.filter((r) => !replaced.some((q) => q !== r && under(r, q)))) ops.push({ op: 'remove', id: r, cascade: true });
for (const [k, o] of B) {
  if (!A.has(k) || gone.has(k)) { ops.push(o); continue; }
  const a = A.get(k);
  if (!same(a.p, o.p) || !same(a.r ?? 0, o.r ?? 0) || !same(a.in, o.in)) ops.push({ op: 'move', id: k, p: o.p, r: o.r ?? 0, ...(same(a.in, o.in) ? {} : { in: o.in }) });
}
const placed = ops.filter((o) => o.op === 'place').length, removed = ops.filter((o) => o.op === 'remove').length, moved = ops.filter((o) => o.op === 'move').length;
const U = { schema: 'god-batch-list/1', note: `Upgrade a world made from mars-two at ${from} to the current template: ${placed} placed, ${removed} removed (cascade), ${moved} moved. Replaced (new def version, contents re-placed): ${replaced.join(', ') || 'none'}.`, from, batches: [{ note: 'removals', ops: ops.filter((o) => o.op === 'remove') }, { note: 'places and moves, parents first', ops: ops.filter((o) => o.op !== 'remove') }] };

// self-check in memory: old genesis + upgrade == new genesis (by path: def, p, r)
const { CORE_KIT, WorldModel, applyBatch } = await import(join(ROOT, 'packages/world-compiler/src/index.ts'));
const { AssetStore } = await import(join(ROOT, 'apps/server/src/god/assets.ts'));
const assets = new AssetStore({ dir: '/tmp/mars-two-check-assets' });
const world = (T) => { const w = new WorldModel({ constants: { ground: 'land', extent: 1000, ...T.constants }, seed: 'check', assets: assets.lookup }); for (const d of CORE_KIT) w.defineDef(d, 'core', 0); return w; };
// the old world holds the defs of its own release: give it the old kit for the names it uses (the current kit carries the
// new versions under the same names; the old versions are what an old world has stored)
const oldKit = (() => { try { return JSON.parse(execFileSync('git', ['-C', ROOT, 'show', `${from}:packages/world-compiler/src/core-kit/mars.json`]).toString()); } catch { return []; } })();
let seq = 0, bad = 0;
const run = (w, list, tag) => { for (const op of list) { const r = applyBatch(w, { ops: [op] }, 'god', ++seq); if (!r.result.accepted) { bad++; console.log(`✖ ${tag} ${op.op} ${op.name ?? op.id}: ${JSON.stringify(r.result.failures).slice(0, 240)}`); } } };
const w1 = world(OLD); for (const d of oldKit) w1.defineDef(d, 'core', 0);
run(w1, OLD.batches.flatMap((b) => b.ops), 'old');
for (const b of U.batches) run(w1, b.ops, 'upgrade');
const w2 = world(NEW); run(w2, NEW.batches.flatMap((b) => b.ops), 'new');
const snap = (w) => { const m = new Map(); const ents = w.entities instanceof Map ? [...w.entities.values()] : Object.values(w.entities); const byId = new Map(ents.map((e) => [e.id, e])); const path = (e) => (e.in?.parent && e.in.parent !== 'world' && byId.get(e.in.parent) ? `${path(byId.get(e.in.parent))}/${e.name}` : e.name); for (const e of ents) m.set(path(e), JSON.stringify([e.def, (e.p ?? []).map((v) => Math.round(v * 1000)), Math.round((typeof e.r === 'number' ? e.r : 0) * 1000)])); return m; };
const s1 = snap(w1), s2 = snap(w2);
const diff = [...new Set([...s1.keys(), ...s2.keys()])].filter((k) => s1.get(k) !== s2.get(k));
console.log(`${U.note}\nself-check: ${bad} refused ops; ${diff.length} entities differ from a fresh world${diff.length ? ': ' + diff.slice(0, 8).map((k) => `${k} ${s1.get(k)} vs ${s2.get(k)}`).join('; ') : ''}`);
if (out) writeFileSync(join(ROOT, out), JSON.stringify(U, null, 1) + '\n');
process.exit(bad || diff.length ? 1 : 0);
