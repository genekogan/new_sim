// Harvest fix kitlenient: kit/2 defines are corrected with a warning (field, what was done) instead of refused, for
// exactly the safe cases; genuinely invalid kits are still refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldModel, applyBatch, batchSchema, correctKitDefines } from './index.ts';

const world = () => new WorldModel({ constants: { ground: 'land' }, seed: 'kit-corrections-test' });
const kit = (shapes: unknown[], extra: Record<string, unknown> = {}, box: number[] | null = [3, 2, 3]) =>
  ({ ops: [{ op: 'define', def: { schema: 'def/1', name: 'trial', size: { ...(box ? { box } : {}), scale: [0.5, 2] }, make: { kind: 'gen', gen: 'kit/2', args: { shapes, ...extra } } } }] });
/** The server path: correct the raw batch, parse it, plan it. */
function admit(batch: unknown) {
  const { batch: fixed, warnings } = correctKitDefines(batch);
  const parsed = batchSchema.safeParse(fixed);
  if (!parsed.success) return { accepted: false as const, detail: parsed.error.message, warnings, fixed };
  const w = world(), r = applyBatch(w, parsed.data, 'god', 0);
  return { ...r.result, warnings, fixed, def: w.def('trial@1') };
}
const stored = (r: ReturnType<typeof admit>) => (r as { def?: { make: { kind: string; args?: { shapes: Record<string, unknown>[] } }; size: { box: number[] } } }).def;

test('unused fields on a primitive (and unknown fields) are removed with a warning on contract 2', () => {
  const r = admit(kit([{ kind: 'ring', at: [0, 1, 0], r: 1, h: 0.2 }, { kind: 'box', at: [0, 0.5, 0], size: [1, 1, 1], tube: 0.1, r: 0.3 }, { kind: 'cone', at: [0, 0.5, 0], r: 0.4, h: 1, r2: 0.1 }], { v: 2 }));
  assert.equal(r.accepted, true, JSON.stringify(r));
  assert.deepEqual(r.warnings, [
    'kit.corrected: trial@1 make.args.shapes.0.h removed (no effect on ring)',
    'kit.corrected: trial@1 make.args.shapes.1.tube removed (not a kit field)',
    'kit.corrected: trial@1 make.args.shapes.1.r removed (no effect on box)',
    'kit.corrected: trial@1 make.args.shapes.2.r2 removed (no effect on cone)',
  ]);
  const shapes = stored(r)!.make.args!.shapes;
  assert.equal(shapes[0].h, undefined); assert.equal(shapes[1].tube, undefined); assert.equal(shapes[1].r, undefined); assert.equal(shapes[2].r2, undefined);
  assert.equal(shapes[0].r, 1); // fields the primitive reads are kept
  // Without the correction the same definition is refused: the fix changes admission, not validation.
  const raw = batchSchema.parse(kit([{ kind: 'ring', at: [0, 1, 0], r: 1, h: 0.2 }], { v: 2 }));
  assert.equal(applyBatch(world(), raw, 'god', 0).result.accepted, false);
});

test('segment counts are clamped into the range the primitive draws', () => {
  const r = admit(kit([
    { kind: 'capsule', at: [0, 1, 0], r: 0.2, h: 1, segments: 16 }, { kind: 'sphere', at: [1, 1, 0], r: 0.3, segments: 40 },
    { kind: 'cyl', at: [0, 0.5, 1], r: 0.2, h: 1, segments: 2 }, { kind: 'sweep', at: [0, 0, 0], path: [[0, 0, 0], [1, 1, 0]], r: 0.05, segments: 12 },
    { kind: 'cyl', at: [1, 0.5, 1], r: 0.2, h: 1, segments: 12.4 }, { kind: 'rbox', at: [0, 0.5, 0], size: [1, 1, 1], round: 0, segments: 3 },
  ], { v: 2 }));
  assert.equal(r.accepted, true, JSON.stringify(r));
  assert.deepEqual(r.warnings, [
    'kit.corrected: trial@1 make.args.shapes.0.segments 16 → 10 (capsule takes 6–10)',
    'kit.corrected: trial@1 make.args.shapes.1.segments 40 → 32 (sphere takes 3–32)',
    'kit.corrected: trial@1 make.args.shapes.2.segments 2 → 3 (cyl takes 3–32)',
    'kit.corrected: trial@1 make.args.shapes.3.segments 12 → 8 (sweep takes 5–8)',
    'kit.corrected: trial@1 make.args.shapes.4.segments 12.4 → 12 (cyl takes 3–32)',
    'kit.corrected: trial@1 make.args.shapes.5.segments removed (no effect on a sharp rbox)',
  ]);
  assert.deepEqual(stored(r)!.make.args!.shapes.map(s => s.segments), [10, 32, 3, 8, 12, undefined]);
  // Contract 1 clamps only to the schema range (it never refused capsule/sweep counts).
  const v1 = admit(kit([{ kind: 'capsule', at: [0, 1, 0], r: 0.2, h: 1, segments: 16 }, { kind: 'sphere', at: [1, 1, 0], r: 0.3, segments: 64 }]));
  assert.equal(v1.accepted, true); assert.deepEqual(v1.warnings, ['kit.corrected: trial@1 make.args.shapes.1.segments 64 → 32 (sphere takes 3–32)']);
});

test('a plain-number scale means uniform [s, s, s], on either contract and inside programs', () => {
  for (const v of [1, 2]) {
    const r = admit(kit([{ kind: 'box', at: [0, 0.5, 0], size: [1, 1, 1], scale: 1.2 }], { v }));
    assert.equal(r.accepted, true, JSON.stringify(r));
    assert.deepEqual(r.warnings, ['kit.corrected: trial@1 make.args.shapes.0.scale 1.2 → [1.2,1.2,1.2] (uniform)']);
    assert.deepEqual(stored(r)!.make.args!.shapes[0].scale, [1.2, 1.2, 1.2]);
  }
  const program = admit(kit([{ kind: 'box', at: [0, 0.5, 0], size: [1, 1, 1], scale: 2, repeat: { n: 2, step: [3, 0, 0] } }], { v: 2 }));
  assert.equal(program.accepted, true, JSON.stringify(program));
});

test('a kit program without box gets the box of its expanded geometry, the bounds admission bakes', () => {
  const r = admit(kit([{ kind: 'box', at: [0, 0.5, 0], size: [1, 1, 0.2], repeat: { n: 3, step: [2, 0, 0] } }], {}, null));
  assert.equal(r.accepted, true, JSON.stringify(r));
  assert.deepEqual(r.warnings, ['kit.corrected: trial@1 size.box computed [5,1,0.2] from the expanded shapes']);
  assert.deepEqual(stored(r)!.size.box, [5, 1, 0.2]);
  // Declared params take their defaults, as at admission.
  const params = { ops: [{ op: 'define', def: { ...kit([{ kind: 'box', at: [0, '$h/2', 0], size: [1, '$h', 1], repeat: { n: '$n', step: [2, 0, 0] } }], {}, null).ops[0].def, params: { h: { type: 'number', default: 3, min: 1, max: 6 }, n: { type: 'int', default: 2, min: 1, max: 9 } } } }] };
  const p = admit(params);
  assert.equal(p.accepted, true, JSON.stringify(p)); assert.deepEqual(stored(p)!.size.box, [3, 3, 1]);
  // A def that brings its own box is never re-measured.
  const own = admit(kit([{ kind: 'box', at: [0, 0.5, 0], size: [1, 1, 1], repeat: { n: 3, step: [2, 0, 0] } }]));
  assert.deepEqual(own.warnings, []); assert.deepEqual(stored(own)!.size.box, [3, 2, 3]);
});

test('genuinely invalid kits are still refused, with the real reason rather than the missing box', () => {
  const bad = (shapes: unknown[], extra: Record<string, unknown> = {}, box: number[] | null = null) => { const r = admit(kit(shapes, extra, box)); assert.equal(r.accepted, false, JSON.stringify(r)); return JSON.stringify(r); };
  assert.match(bad([{ kind: 'box', at: [0, 0.5, 0], size: [1, -1, 1] }], { v: 2 }, [1, 1, 1]), /dimensions must be positive/);
  assert.match(bad([{ kind: 'no-such-shape', at: [0, 0, 0] }], {}, [1, 1, 1]), /kind/);
  assert.match(bad([{ kind: 'box', at: [0, 0.5, 0], size: [1, 1, 1], scale: 0 }], { v: 2 }, [1, 1, 1]), /nonzero/);
  assert.match(bad([{ kind: 'box', at: [0, 0.5, 0], size: [1, 1, 1], pivot: [0, 1, 0] }], { v: 2 }, [1, 1, 1]), /needs an animation role/);
  // A box-less program that cannot expand: refused for its expansion, never "size.box required".
  const msg = bad([{ kind: 'box', at: [0, 0, 0], size: [1, '$undeclared', 1], repeat: { n: 2, step: [1, 0, 0] } }]);
  assert.match(msg, /undeclared/); assert.doesNotMatch(msg, /size\.box/);
});

test('non-kit defines and other ops pass through untouched (same object)', () => {
  const batch = { ops: [{ op: 'place', def: 'core/bench@1', at: [0, 0] }, { op: 'define', def: { schema: 'def/1', name: 'n', size: { box: [1, 1, 1] }, make: { kind: 'none' } } }] };
  assert.equal(correctKitDefines(batch).batch, batch);
  const clean = kit([{ kind: 'box', at: [0, 0.5, 0], size: [1, 1, 1] }], { v: 2 });
  assert.equal(correctKitDefines(clean).batch, clean); assert.deepEqual(correctKitDefines(clean).warnings, []);
  assert.deepEqual(correctKitDefines({ preview: 'pv_1' }), { batch: { preview: 'pv_1' }, warnings: [] });
});
