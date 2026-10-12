#!/usr/bin/env node
// CATRUN: prove an existing world boots identically with the shared core library (engine fix i).
//   node tools/catalog/old-world-check.mjs <copy-of-sim.db> [worldId]
// Opens a COPY of a world DB twice: once with no library (exactly what the world stores) and once with the shared core
// library (the new GodMode default). Asserts the viewer snapshot is byte-identical, every stored def keeps its hash, and
// that loading wrote nothing (row and edit counts unchanged). Never point it at a live DB: it opens the file read-write.
import { createHash } from 'node:crypto';
import { Db } from '../../apps/server/src/db.ts';
import { GodMode } from '../../apps/server/src/god/god.ts';

const [file, idArg] = process.argv.slice(2);
if (!file) { console.error('usage: old-world-check.mjs <copy-of-sim.db> [worldId]'); process.exit(2); }
const db = new Db(file);
const ids = idArg ? [idArg] : db.db.prepare('SELECT world_id FROM world_meta_v1').all().map((r) => r.world_id);
const count = (t, w) => db.db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE world_id=?`).get(w).n;
const sha = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);
let bad = 0;
for (const w of ids) {
  const before = { defs: count('world_defs_v1', w), edits: count('world_edits_v1', w), entities: count('world_entities_v1', w) };
  const o = { worldId: w, ownerId: null, tick: () => 0, emit: () => {} };
  const t0 = performance.now(); const bare = new GodMode(db, { ...o, library: null }); const t1 = performance.now();
  const god = new GodMode(db, o); const t2 = performance.now();
  const a = bare.publicSnapshot(), b = god.publicSnapshot();
  delete a.tick; delete b.tick;
  const after = { defs: count('world_defs_v1', w), edits: count('world_edits_v1', w), entities: count('world_entities_v1', w) };
  const hashes = [...new Set(bare.model.defs.values())].every((d) => god.model.def(d.ref)?.hash === d.hash || god.model.def('sha:' + d.hash));
  const same = JSON.stringify(a) === JSON.stringify(b);
  const ok = same && hashes && JSON.stringify(before) === JSON.stringify(after);
  if (!ok) bad++;
  console.log(JSON.stringify({ world: w, ok, sameSnapshot: same, snapshot: sha(b), hashesKept: hashes, rows: before, rowsAfter: after, entities: b.entities.length, defsInUse: b.defs.length, ownDefs: new Set(god.model.defs.values()).size, libraryOnly: god.model.allDefs().length - new Set(god.model.defs.values()).size, loadMs: { bare: Math.round(t1 - t0), library: Math.round(t2 - t1) } }));
}
process.exit(bad ? 1 : 0);
