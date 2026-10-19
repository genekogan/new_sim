// Harvest fix kitlenient: dryrun, preview, act and the kit workbench correct kit/2 defines the same way, report each
// correction in `warnings`, and journal the corrected definition (so replay never meets the uncorrected one).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../db.ts';
import { GodMode } from './god.ts';
import { admitWorkbench } from './workbench.ts';

const def = (name: string) => ({ schema: 'def/1', name, size: { scale: [0.5, 2] }, make: { kind: 'gen', gen: 'kit/2', args: { v: 2, shapes: [{ kind: 'ring', at: [0, 1, 0], r: 1, h: 0.2, segments: 64 }, { kind: 'box', at: [0, 0.5, 0], size: [1, 1, 0.2], scale: 1.5, repeat: { n: 2, step: [2, 0, 0] } }] } } });
const expected = (name: string) => [
  `kit.corrected: ${name}@1 make.args.shapes.0.segments 64 → 32 (ring takes 3–32)`,
  `kit.corrected: ${name}@1 make.args.shapes.0.h removed (no effect on ring)`,
  `kit.corrected: ${name}@1 make.args.shapes.1.scale 1.5 → [1.5,1.5,1.5] (uniform)`,
];
function fixture(t: { after(fn: () => void): void }) {
  const db = new Db(':memory:'); t.after(() => db.close());
  return new GodMode(db, { worldId: 'kitlenient', ownerId: 'dev:owner', tick: () => 0, emit: () => {} });
}
test('dryrun, preview, act and workbench accept the corrected kit and list the corrections', t => {
  const god = fixture(t);
  const corrections = (w: string[] | undefined, name: string) => { const k = (w ?? []).filter(x => x.startsWith('kit.corrected: ')); assert.deepEqual(k.slice(0, 3), expected(name)); assert.match(k[3], new RegExp(`^kit.corrected: ${name}@1 size.box computed \\[`)); };
  const dry = god.dryrun({ ops: [{ op: 'define', def: def('a') }] }); assert.equal(dry.accepted, true, JSON.stringify(dry)); if (dry.accepted) corrections(dry.warnings, 'a');
  const bench = admitWorkbench(god, { def: def('b') }); assert.equal(bench.accepted, true, JSON.stringify(bench)); if (bench.accepted) corrections(bench.warnings, 'b');
  const pv = god.preview({ ops: [{ op: 'define', def: def('c') }] }); assert.equal(pv.accepted, true, JSON.stringify(pv)); corrections((pv as { warnings?: string[] }).warnings, 'c');
  // Committing the preview by id or with the same raw ops matches the sealed (corrected) batch.
  const viaPreview = god.act({ preview: pv.id!, ops: [{ op: 'define', def: def('c') }] }); assert.equal(viaPreview.accepted, true, JSON.stringify(viaPreview));
  const r = god.act({ ops: [{ op: 'define', def: def('d') }] }); assert.equal(r.accepted, true, JSON.stringify(r)); if (r.accepted) corrections(r.warnings, 'd');
  const journaled = god.store.edits().map(e => JSON.stringify(e.ops)).join('\n');
  assert.doesNotMatch(journaled, /"h":0\.2|"segments":64|"scale":1\.5/); assert.match(journaled, /"box":\[/);
  assert.ok(god.model.def('d@1')); assert.equal(god.model.def('d@1')!.make.kind, 'gen');
});
test('an invalid kit is still refused on every path', t => {
  const god = fixture(t), bad = { ...def('e'), make: { kind: 'gen', gen: 'kit/2', args: { v: 2, shapes: [{ kind: 'box', at: [0, 0.5, 0], size: [1, -1, 1] }] } } };
  assert.equal(god.dryrun({ ops: [{ op: 'define', def: bad }] }).accepted, false);
  assert.equal(god.preview({ ops: [{ op: 'define', def: bad }] }).accepted, false);
  assert.equal(god.act({ ops: [{ op: 'define', def: bad }] }).accepted, false);
  assert.equal(admitWorkbench(god, { def: bad }).accepted, false);
  assert.equal(god.model.def('e@1'), undefined);
});
