// srv-hub-physics item 2: the entity-physics hash resumes from the previous physics' digest at the first changed entity
// (core/hash.ts hashPhysicsResumable). It must equal the full recompute for every kind of edit, with and without a mark.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { hashPhysicsResumable, PART_TEXT, setSha256Provider, stableStringify, type Sha256Stream } from '../../../mars/viewer/engine/core/hash.ts';
import { entityPhysicsHash, nextEntityPhysics, type WorldEditV1 } from './entity-physics.ts';

type S = Sha256Stream & { copy(): S };
const streamOf = (h: ReturnType<typeof createHash>): S => ({ update: (p) => { h.update(p, 'utf8'); }, digest: () => h.digest('hex'), copy: () => streamOf(h.copy()) });
function withNativeHash(fn: () => void) {
  setSha256Provider((t) => createHash('sha256').update(t, 'utf8').digest('hex'), () => streamOf(createHash('sha256')));
  try { fn(); } finally { setSha256Provider(); }
}
const part = (i: number, dx = 0) => ({ solids: [{ id: `e_${i}#c0`, obb: { c: [i + dx, -i], half: [0.5, 0.25], yaw: 0 }, y0: 0, y1: 2 }],
  surfaces: [{ id: `e_${i}#f`, level: 0, obb: { c: [i, i], half: [1, 1], yaw: 0 }, y: 0.1 * (i % 3) }] });
const edit = (seq: number, set: WorldEditV1['set'], extra: Partial<WorldEditV1> = {}): WorldEditV1 => ({ contract: 'world-edit/1', seq, hash: '', levels: [{ id: 1, y: 3, label: 'up' }] as never, set, ...extra });

test('resumed physics hash = full recompute: modify first/middle/last, add before/after, remove, assets, levels, no-op', () => withNativeHash(() => {
  const set: WorldEditV1['set'] = {};
  for (let i = 0; i < 100; i++) set[`e_${String(i).padStart(3, '0')}`] = part(i) as never;
  let p = nextEntityPhysics(undefined, edit(0, set, { assets: { 'ew:a': { id: 'ew:a', size: 1 } } }));
  assert.equal(p.hash, entityPhysicsHash(p));
  const steps: [string, WorldEditV1][] = [
    ['modify first', edit(1, { e_000: part(0, 0.5) as never })],
    ['modify middle', edit(2, { e_050: part(50, 0.5) as never })],
    ['modify last', edit(3, { e_099: part(99, 0.5) as never })],
    ['modify at a checkpoint', edit(4, { e_032: part(32, 0.5) as never })],
    ['add before all', edit(5, { a_first: part(7) as never })],
    ['add after all', edit(6, { z_last: part(8) as never })],
    ['remove middle', edit(7, { e_040: null })],
    ['new asset', edit(8, { e_060: part(60, 1) as never }, { assets: { 'ew:b': { id: 'ew:b', size: 2 } } })],
    ['levels change', edit(9, { e_061: part(61, 1) as never }, { levels: [{ id: 1, y: 3.5, label: 'up' }, { id: 2, y: 7, label: 'roof' }] as never })],
    ['no-op', edit(10, {})],
    ['remove all but one', edit(11, Object.fromEntries(Object.keys(p.byEntity).slice(1).map((k) => [k, null])))],
  ];
  for (const [what, e] of steps) {
    const q = nextEntityPhysics(p, e);
    assert.equal(q.hash, entityPhysicsHash(q), what);
    assert.equal(q.hash, nextEntityPhysics(structuredClone(p), e).hash, `${what}: a physics without a mark (a decoded snapshot) builds the same`);
    p = q;
  }
}));

test('a mark is only copied: two edits from the same physics, and a stale mark, still hash right', () => withNativeHash(() => {
  const by: Record<string, unknown> = {}; for (let i = 0; i < 40; i++) by[`k${i}`] = part(i);
  for (const v of Object.values(by)) PART_TEXT.set(v as object, stableStringify(v));
  const full = (x: Record<string, unknown>) => entityPhysicsHash({ levels: [], byEntity: x, assets: {} } as never);
  const base = hashPhysicsResumable({ levels: [], byEntity: by, assets: {} }, PART_TEXT as never, undefined);
  assert.equal(base.hash, full(by));
  const a = { ...by, k20: part(20, 3) }, b = { ...by, k5: part(5, 3) };
  for (const v of [a.k20, b.k5]) PART_TEXT.set(v as object, stableStringify(v));
  const ha = hashPhysicsResumable({ levels: [], byEntity: a, assets: {} }, PART_TEXT as never, base.mark);
  const hb = hashPhysicsResumable({ levels: [], byEntity: b, assets: {} }, PART_TEXT as never, base.mark);
  assert.equal(ha.hash, full(a)); assert.equal(hb.hash, full(b));
  // resuming from `a`'s mark onto a value derived from `b` (different leading part): falls back to the right checkpoint
  assert.equal(hashPhysicsResumable({ levels: [], byEntity: b, assets: {} }, PART_TEXT as never, ha.mark).hash, full(b));
  // without a copyable native stream it is plain hashStable
  setSha256Provider();
  assert.equal(hashPhysicsResumable({ levels: [], byEntity: a, assets: {} }, PART_TEXT as never, ha.mark).hash, full(a));
}));
