// PERSON-GO: naming a resident reaches that body rather than repeatedly suggesting its containing room.
import test from 'node:test';
import assert from 'node:assert/strict';
import {edenNavWorld} from '../test/eden-nav-fixture.ts';

async function apart(t: any) {
  const w = await edenNavWorld(2), [a, b] = w.souls;
  t.after(() => {w.f.host.stop(); w.f.db.close();});
  for (const [s, id] of [[a, 'eden-north-woods'], [b, 'eden-gardens']] as const) {
    const p = w.ledger.places.byId.get(id)!.polygon, body = w.engine.world.entities[s.entityId];
    body.pose.p[0] = p.reduce((n, xy) => n + xy[0], 0) / p.length;
    body.pose.p[2] = p.reduce((n, xy) => n + xy[1], 0) / p.length;
  }
  return {w, a, b};
}

test('person-go: dry resolve names the exact out-of-sight body without mutating perception', async t => {
  const {w, a, b} = await apart(t), cap = 'go-near:' + b.soulId;
  const before = w.ledger.capabilities(a).map(c => c.id), tick = w.engine.world.tick;
  assert.ok(!before.includes(cap), 'target is outside the visible listing');
  for (const words of [`go to ${b.name}`, `go near ${b.name}`, `find ${b.name}`, `go to ${b.soulId}`, cap]) {
    const r = w.ledger.intents.dryRun(a, {capability: words}) as any;
    assert.equal(r.ok, true, words + ': ' + JSON.stringify(r));
    assert.equal(r.would.capability, cap);
    assert.equal(r.would.available, true);
  }
  assert.equal(w.engine.world.tick, tick);
  assert.deepEqual(w.ledger.capabilities(a).map(c => c.id), before);
  assert.deepEqual(w.ledger.together.invitesFor(b.soulId), []);
});

test('person-go: on-demand targets retain faded, missing, range and ambiguous-name guards', async t => {
  const {w, a, b} = await apart(t), cap = 'go-near:' + b.soulId;
  const noTarget = (words: string) => {
    const r = w.ledger.intents.dryRun(a, {capability: words}) as any;
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.notEqual(r.would?.capability, cap, JSON.stringify(r));
  };
  w.ledger.faded.add(b.soulId);
  noTarget(`go to ${b.name}`); noTarget(cap);
  w.ledger.faded.delete(b.soulId);
  const body = w.engine.world.entities[b.entityId], x = body.pose.p[0];
  body.pose.p[0] += 500;
  noTarget(`go to ${b.name}`); noTarget(cap);
  body.pose.p[0] = x;
  const previous = w.f.host.soulNameRefusal;
  w.f.host.soulNameRefusal = ref => ref.toLowerCase() === b.name.toLowerCase() ? 'soul.name-ambiguous' : previous.call(w.f.host, ref);
  noTarget(`go to ${b.name}`);
  w.f.host.soulNameRefusal = previous;
  const missing = w.ledger.intents.dryRun(a, {capability: 'go-near:s_0000000000'}) as any;
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'capability.unknown');
});

test('person-go: exact resolved capability physically reaches a stationary distant body', {timeout: 900000}, async t => {
  const {w, a, b} = await apart(t);
  const out = await w.act(a, 'go-near:' + b.soulId) as any;
  assert.equal(out.accepted, true, JSON.stringify(out));
  assert.equal(out.receipt.capability, 'go-near:' + b.soulId);
  await w.run([{soulId: a.soulId, id: out.receipt.id}], 20 * 180);
  const ra = w.ledger.receipt(a.soulId, out.receipt.id)!;
  const aa = w.engine.world.entities[a.entityId].pose.p, bb = w.engine.world.entities[b.entityId].pose.p;
  const distance = Math.hypot(aa[0] - bb[0], aa[2] - bb[2]);
  t.diagnostic(JSON.stringify({phase: ra.phase, code: ra.code, distance}));
  assert.equal(ra.phase, 'completed', JSON.stringify(ra));
  assert.ok(distance <= 2, 'arrives by the body: ' + distance);
  assert.ok(w.ledger.capabilities(a).some(c => c.id === 'go-near:' + b.soulId), 'nearby body remains visibly offered');
  const visible = w.ledger.intents.dryRun(a, {capability: `go to ${b.name}`}) as any;
  assert.equal(visible.would?.capability, 'go-near:' + b.soulId);
  assert.deepEqual(w.f.host.engine.runtime.violations, []);
});
