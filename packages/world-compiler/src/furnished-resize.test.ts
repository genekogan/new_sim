// B12: a furnished building's furniture keeps its place in its room when the building is resized, so a resize that would
// push a piece through a wall is refused (`size.furnished`), naming the smallest w / d its furniture still fits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_KIT, WorldModel, applyBatch, refusalCodes, type Failure, type Refused } from './index.ts';

function church() {
  const w = new WorldModel({ constants: { ground: 'land' }, seed: 'b12' });
  for (const d of CORE_KIT) w.defineDef(d, 'core', 0);
  const r = applyBatch(w, { ops: [{ op: 'place', def: 'core/church@1', name: 'church', p: [0, 0] }] }, 'god', 0).result;
  assert.equal(r.accepted, true, JSON.stringify(r));
  return w;
}
const set = (w: WorldModel, params: Record<string, unknown>, trusted = false) => applyBatch(w, { ops: [{ op: 'set', id: 'church', params }] } as never, 'god', 1, { trusted }).result;

test('shrinking a furnished church through its furniture is refused, naming the smallest w and d that fit', () => {
  const w = church(), before = w.snapshot();
  assert.ok((w.children.get(w.get('church')!.id)?.size ?? 0) > 10, 'the church places its pews and altar');
  const r = set(w, { w: 6, d: 12 }) as Refused, f = r.failures[0] as Failure & { limit: { w: number; d: number } };
  assert.equal(r.accepted, false);
  assert.equal(f.code, 'size.furnished');
  assert.ok(refusalCodes.includes(f.code as never));
  assert.match(f.detail, /^church is furnished: \d+ pieces \(nave-[a-z-]+, .* would poke through its walls at that size; its furniture fits down to w [\d.]+ m and d [\d.]+ m$/);
  assert.ok(f.limit.w > 6 && f.limit.w <= 10 && f.limit.d > 12 && f.limit.d <= 18, JSON.stringify(f.limit));
  assert.match(f.fix!, /Keep w ≥ [\d.]+ and d ≥ [\d.]+\. .*select --in church --remove.*furnish church/);
  assert.deepEqual(w.snapshot(), before, 'a refused resize leaves the world as it was');
  // the named minimum is itself accepted
  assert.equal(set(w.fork(), { w: f.limit.w }).accepted, true);
  assert.equal(set(w.fork(), { d: f.limit.d }).accepted, true);
});

test('growing a furnished building and other params stay accepted', () => {
  const w = church();
  assert.equal(set(w.fork(), { w: 12, d: 22 }).accepted, true);
  assert.equal(set(w.fork(), { roofColor: '#334455' }).accepted, true);
});

test('a building without furniture shrinks to its def minimum as before', () => {
  const w = church();
  const kids = [...(w.children.get(w.get('church')!.id) ?? [])];
  assert.equal(applyBatch(w, { ops: kids.map((id) => ({ op: 'remove', id })) }, 'god', 1).result.accepted, true);
  const r = set(w, { w: 10, d: 12 });
  assert.equal(r.accepted, true, JSON.stringify(r));
});

test('an older world whose building already pokes: edits that add no new poking piece are accepted; undo is not checked', () => {
  const w = church();
  // an older world: the church was shrunk before this check existed (a trusted batch skips it, as undo and redo do)
  assert.equal(set(w, { w: 7 }, true).accepted, true);
  assert.equal(set(w.fork(), { roofColor: '#334455' }).accepted, true, 'recolouring an already-poking church');
  assert.equal(set(w.fork(), { w: 8.5 }).accepted, true, 'growing it part of the way back');
  const r = set(w.fork(), { w: 5 }) as Refused;
  assert.equal(r.failures?.[0].code, 'size.furnished', 'shrinking it further pushes more pieces through');
});
