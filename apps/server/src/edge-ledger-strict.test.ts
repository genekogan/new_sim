// strict/1 (Core-A; field evidence: `walk:eden-pond-north` was accepted and "completed" at the wrong place): an
// id-shaped target that names nothing in this world is refused with a reason and nothing happens; a real place that no
// walk reaches is refused with why; plain words and real ids keep working; every terminal receipt says where the body
// ended up (endedAt {place, placePath, pos, heading, posture}).
import test from 'node:test';
import assert from 'node:assert/strict';
import {coreAWorld} from '../test/core-a-fixture.ts';
import {accept} from '../test/native-owner-fixture.ts';

const BAD = ['walk:eden-pond-north', 'walk:eden-commons', 'walk:north-woods', 'stroll:eden-pond-north', 'hang-out:the-big-lake', 'sit:bench-99', 'read:eden-library-9',
  'go-near:s_nobody', 'follow:s_nobody', 'hug:s_nobody', 'warm-by-fire:fire-pit-7', 'play-piano:grand-piano-1', 'swim:eden-pond-north', 'gather:eden-pond-north', 'walk:region-park.lake'];

test('strict: invented ids refuse with a reason and change nothing; real ids and plain words still resolve', {timeout: 300000}, async t => {
  const w = await coreAWorld(2); t.after(() => w.close());
  const [a, b] = w.souls, count = () => (w.f.db.db.prepare('SELECT COUNT(*) n FROM edge_receipts_v1').get() as {n: number}).n, before = count(), at = w.pos(a);
  for (const id of BAD) {
    const out: any = await w.act(a, id);
    assert.equal(out.accepted, false, id + ' ' + JSON.stringify(out));
    assert.equal(out.code, 'capability.unknown', id);
    assert.match(out.reason, /not an id in this world/, id);
    assert.ok(Array.isArray(out.did_you_mean), id);
    // the same over HTTP and as a dry run
    const dry = (await w.http(a, 'POST', '/v1/edge/resolve', {capability: id})).body.resolve;
    assert.equal(dry.ok, false, id); assert.equal(dry.code, 'capability.unknown', id);
  }
  assert.equal(count(), before, 'no receipt was written for any invented id');
  await w.ticks(40); assert.deepEqual(w.pos(a), at, 'the body never moved');
  // the regression itself: the skill's old example id
  const pond = (await w.http(a, 'POST', '/v1/edge/act', {capability: 'walk:eden-pond-north'})).body;
  assert.equal(pond.accepted, false); assert.ok(pond.did_you_mean.some((d: any) => d.id === 'walk:region-park' || d.id === 'walk:shore-water' || d.id === 'walk:eden-north-woods'), JSON.stringify(pond.did_you_mean));
  // a real place in the map that no walk reaches: a reason, never a different place (intent form)
  const park = (await w.http(a, 'POST', '/v1/edge/act', {verb: 'go', target: {place: 'region-park.pond'}})).body;
  assert.equal(park.accepted, false); assert.equal(park.code, 'place.unwalkable'); assert.match(park.reason, /no walk reaches it/);
  // real ids and plain words keep working
  for (const ok of ['walk:shore-bank', 'walk:pond', 'walk to the campfire', 'sit:here', `go-near:${b.soulId}`]) {
    const out: any = await w.act(a, ok); assert.equal(out.accepted, true, ok + ' ' + JSON.stringify(out));
  }
  assert.deepEqual(w.f.host.engine.runtime.violations, []);
});

test('strict: every terminal receipt carries endedAt (completed, replaced, failed, attention, stand)', {timeout: 300000}, async t => {
  const w = await coreAWorld(2); t.after(() => w.close());
  const [a, b] = w.souls;
  const walk: any = await w.act(a, 'walk:shore-bank'); assert.equal(walk.accepted, true);
  await w.ticks(8000, () => !w.open(a, walk.receipt.id));
  const done = w.receipt(a, walk.receipt.id); assert.equal(done.phase, 'completed');
  const e = done.endedAt as any; assert.equal(e.place, 'shore-bank'); assert.ok(e.placePath.length >= 2 && e.placePath.includes('Eden'), JSON.stringify(e));
  assert.equal(e.posture, 'standing'); assert.ok(Number.isInteger(e.heading) && e.heading >= 0 && e.heading < 360); assert.ok(Math.hypot(e.pos[0] - w.pos(a)[0], e.pos[1] - w.pos(a)[1]) < 0.2);
  // replaced by the Soul's own newer act; then failed (interrupted by the world)
  const r1: any = await w.act(b, 'rest:here', {seconds: 600}), r2: any = await w.act(b, 'rest:here', {seconds: 600});
  assert.equal(w.receipt(b, r1.receipt.id).phase, 'replaced'); assert.ok((w.receipt(b, r1.receipt.id).endedAt as any)?.posture, 'replaced has endedAt');
  await w.ticks(60);
  await accept(w.f.host, w.f.host.enqueue('edge-stop', 'test:interrupt', {soulId: b.soulId, entityId: b.entityId})); await w.ticks(60);
  const r2e = w.receipt(b, r2.receipt.id); assert.equal(r2e.phase, 'failed'); assert.ok((r2e.endedAt as any)?.place, 'failed has endedAt');
  // attention and stand receipts
  const look: any = await w.act(a, `look at ${b.name}`); assert.equal(look.accepted, true, JSON.stringify(look));
  assert.equal(w.receipt(a, look.receipt.id).phase, 'completed'); assert.equal((w.receipt(a, look.receipt.id) as any).channel, 'attention'); assert.ok((w.receipt(a, look.receipt.id).endedAt as any)?.place);
  const st: any = await w.act(a, 'stand:here'); await w.ticks(40); assert.ok((w.receipt(a, st.receipt.id).endedAt as any)?.posture);
  // every terminal receipt written in this world has endedAt with the five fields
  for (const row of w.f.db.db.prepare("SELECT receipt_id, soul_id FROM edge_receipts_v1 WHERE phase NOT IN ('waiting','started')").all() as {receipt_id: string; soul_id: string}[]) {
    const r = w.ledger.receipt(row.soul_id, row.receipt_id)!, end = r.endedAt as any;
    assert.ok(end && 'place' in end && Array.isArray(end.placePath) && Array.isArray(end.pos) && 'heading' in end && typeof end.posture === 'string', r.capability + ' ' + JSON.stringify(r));
  }
  const http = (await w.http(a, 'GET', `/v1/edge/receipts/${walk.receipt.id}`)).body;
  assert.equal(http.receipt.endedAt.place, 'shore-bank');
  assert.deepEqual(w.f.host.engine.runtime.violations, []);
});
