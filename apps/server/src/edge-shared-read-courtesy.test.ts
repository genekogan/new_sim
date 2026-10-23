// BROWSE-COURTESY (2026-10-23): a full invited shared read (shelf browse, read, return browse) for two native bodies in the
// same library, the host never stood up or moved by the test. Live386 lost a body with pose.not-still after a courtesy step
// aside. Where the guest waits decides the race (before the fix): at [70.5,-5.5] a make-way nudge lands on the host the tick
// its shelf walk ends, so its browse was refused pose.not-still; at [70.6,-6.2] and [71.5,-7.45] the guest's walk nudged the
// host's first or return browse (pose.moved). Both receipts must complete with both bodies reading the requested 60 s.
import test from 'node:test';
import assert from 'node:assert/strict';
import {coreAWorld} from '../test/core-a-fixture.ts';

for (const [label, at] of [['host browse would start inside a nudge', [70.5, -5.5]], ['guest passes the host\'s first browse', [70.6, -6.2]],
  ['guest passes the host\'s return browse', [71.5, -7.45]], ['guest left where its walk ended', null]] as const)
  test(`simultaneous invited shared read (${label}): both full plans complete, both bodies read natively for 60 s`, async t => {
    const w = await coreAWorld(2), [a, b] = w.souls; t.after(w.close);
    const place = 'eden-library-1';
    for (const s of [a, b]) {
      const go = await w.http(s, 'POST', '/v1/edge/act', {verb: 'go', target: {place}});
      assert.equal(go.body.accepted, true, JSON.stringify(go.body));
      await w.ticks(2400, () => !w.open(s, go.body.receipt.id));
      assert.equal(w.receipt(s, go.body.receipt.id).phase, 'completed', 'initial library walk completes');
    }
    if (at) {await w.put(b, [...at]); await w.ticks(40);}
    for (const s of [a, b]) assert.ok(['idle', 'wait'].includes(w.body(s).human.activity), `${s.name} is idle before the request`);
    const host = await w.http(a, 'POST', '/v1/edge/act', {verb: 'read', target: {place, seconds: 60, with: b.name}});
    assert.equal(host.body.accepted, true, JSON.stringify(host.body));
    const inv = w.ledger.together.invitesFor(b.soulId)[0]; assert.ok(inv, 'the shared read invites the guest'); assert.equal(inv.seconds, 60);
    const guest = await w.http(b, 'POST', '/v1/edge/act', {capability: 'accept:' + inv.id});
    assert.equal(guest.body.accepted, true, JSON.stringify(guest.body));
    const runs = [[a, host.body.receipt.id], [b, guest.body.receipt.id]] as const;
    const reading = new Map<string, number[]>(runs.map(([s]) => [s.soulId, []])), nudges = new Set<string>();
    await w.ticks(8000, () => {
      for (const [s] of runs) if (w.body(s).human.activity === 'read') reading.get(s.soulId)!.push(w.engine.world.tick);
      for (const id of w.engine.runtime.records.keys()) if (id.includes(':make-way:') && runs.some(([s]) => id.startsWith(s.entityId + ':'))) nudges.add(id);
      return runs.every(([s, id]) => !w.open(s, id));
    });
    const out = runs.map(([s, id]) => {
      const rec = w.receipt(s, id), ticks = reading.get(s.soulId)!;
      return {who: s.name, phase: rec.phase, code: rec.code, readSeconds: ticks.length / 20, readSpan: ticks.length ? (ticks.at(-1)! - ticks[0] + 1) / 20 : 0};
    });
    t.diagnostic(JSON.stringify({out, nudges: nudges.size}));
    for (const o of out) {
      assert.equal(o.phase, 'completed', `${o.who}'s shared read receipt completes (${o.code})`);
      assert.ok(o.readSeconds >= 55 && o.readSpan <= 90, `${o.who} natively reads the requested 60 s (read ${o.readSeconds}s over ${o.readSpan}s)`);
    }
  });
