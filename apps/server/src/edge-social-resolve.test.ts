// SOCIAL-INVITE: planning a social act must offer the same distant approach as acting it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {edenNavWorld} from '../test/eden-nav-fixture.ts';

test('dry-running a named social approach outside sight resolves without inviting or changing the listing', async t => {
  const w = await edenNavWorld(2), [a, b] = w.souls;
  t.after(() => {w.f.host.stop(); w.f.db.close();});
  // Fixture positions in opposite known places; no movement simulation is needed to test dry-run resolution.
  for (const [s, id] of [[a, 'eden-north-woods'], [b, 'eden-gardens']] as const) {
    const p = w.ledger.places.byId.get(id)!.polygon;
    const body = w.engine.world.entities[s.entityId];
    body.pose.p[0] = p.reduce((n, xy) => n + xy[0], 0) / p.length;
    body.pose.p[2] = p.reduce((n, xy) => n + xy[1], 0) / p.length;
  }
  const caps = w.ledger.capabilities(a).map(c => c.id), tick = w.engine.world.tick;
  assert.ok(!caps.includes('go-near:' + b.soulId), 'target is outside the visible listing');
  for (const [words, verb] of [['hug', 'hug'], ['dance with', 'dance-with'], ['high five', 'high-five']] as const) {
    const result = w.ledger.intents.dryRun(a, {capability: `${words} ${b.name}`}) as any;
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.would.capability, `${verb}:${b.soulId}`);
    assert.equal(result.would.available, true);
  }
  assert.equal(w.engine.world.tick, tick);
  assert.deepEqual(w.ledger.capabilities(a).map(c => c.id), caps, 'dry run leaves cached offered capabilities unchanged');
  assert.deepEqual(w.ledger.together.invitesFor(b.soulId), [], 'dry run sends no invitation');
});
