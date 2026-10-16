// R2 stroll (longrun 2026-10-16) on the real construction layer: the release-check walk1 build ("Release walk lighthouse",
// site 30,30 30×20, tower 9×9 + yard 8×8) closes one stop of the Green field's 5-stop loop, so stroll:field is blocked.
// The residents' own phrases now wander in place and move the body; the refusal names that alternative; a different,
// reachable place still walks there; the site itself is still refused.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { fixture, invite, accept, factory } from '../../test/native-owner-fixture.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
async function world(t: TestContext) {
  const w = fixture(':memory:', factory, { durableClockV1: true }); w.brain.quiesce();
  const god = new GodMode(w.db, { worldId: w.host.worldId, ownerId: 'owner', tick: () => w.host.engine.world.tick, now: () => 1_000_000, buildPauseMs: 50, buildClosureMs: 500, emit: () => {} });
  const edge = new EdgeLedger(w.host, w.db); installEngineBridge({ host: w.host, god, edge, log() {}, worldClock: false, worldLore: false });
  const caller = god.godIdentity(god.mintFor({ id: 'owner', role: 'user' }, 'builder'))!;
  t.after(() => { w.brain.quiesce(); w.host.stop(); edge.comms?.close(); w.db.close(); });
  const settle = async (n = 3) => { for (let i = 0; i < n; i++) { w.host.tickOnce(); await setImmediate(); w.host.drainInputs(); } };
  await invite(w, 'ada'); const row: any = await accept(w.host, w.souls.create('dev:ada', { name: 'Ada', description: 'curious' })); await settle(3);
  const s = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
  const placed = god.act({ ops: [
    { op: 'define', def: { schema: 'def/1', name: 'stroll-cottage', version: 1, tags: ['building'], size: { box: [8, 3, 6] }, make: { kind: 'gen', gen: 'building/1', args: { style: 'shed' } }, params: { floors: { type: 'int', min: 1, max: 6, default: 1 } }, components: { foundation: { kind: 'none' } } } },
    { op: 'place', def: 'stroll-cottage@1', name: 'cottage', p: [-15, -15] },
    { op: 'place', def: 'stroll-cottage@1', name: 'walk-lighthouse', p: [24, 30] },
  ] }); assert.equal(placed.accepted, true, JSON.stringify(placed)); await settle();
  const start = god.builds.start({ id: 'walk1', title: 'Release walk lighthouse', steps: ['massing', 'tower', 'sign'], root: 'walk-lighthouse', site: { at: [30, 30], size: [30, 20] },
    massing: [{ name: 'tower', at: [-6, 0], size: [9, 9], h: 14 }, { name: 'yard', at: [7, 0], size: [8, 8], h: 1 }] }, caller) as any;
  assert.equal(start.ok, true, JSON.stringify(start)); await settle(2);
  const pos = (): [number, number] => { const p = (w.host.engine.world as any).entities[s.entityId].pose.p; return [p[0], p[2]]; };
  const run = async (n: number) => { for (let i = 0; i < n; i++) { w.host.tickOnce(); if (i % 20 === 0) { await setImmediate(); w.host.drainInputs(); } } };
  const act = (capability: string) => accept(w.host, edge.act(s, { capability })) as Promise<any>;
  return { w, god, edge, s, pos, run, act, settle };
}

test('stroll (release 2): the longrun phrases wander in place and move the body while walk1 closes the field loop', { timeout: 120000 }, async t => {
  const x = await world(t);
  const loop = x.edge.capabilities(x.s).find(c => c.id === 'stroll:field');
  assert.equal(loop?.available, false); assert.equal(loop?.blocked?.code, 'site.under-construction', 'the field loop is closed by walk1');
  for (const phrase of ['stroll around the Green field', 'take a walk through the Green field', 'take a walk through the park', 'tour the Green field']) {
    const before = x.pos(), out = await x.act(phrase);
    assert.equal(out.accepted, true, `${phrase}: ${JSON.stringify(out)}`); assert.equal(out.receipt.capability, 'wander:here', phrase);
    assert.match(out.resolved.note, /walk1 is under construction/, phrase);
    let moved = 0; for (let i = 0; i < 12 && moved < 1; i++) { await x.run(100); moved = Math.max(moved, Math.hypot(x.pos()[0] - before[0], x.pos()[1] - before[1])); }
    t.diagnostic(`${phrase}: moved ${moved.toFixed(2)} m`); assert.ok(moved >= 1, `${phrase}: moved ${moved.toFixed(2)} m`);
    await x.act('stand:here'); await x.settle(2);
  }
});

test('stroll (release 2): the site refusal names the in-place alternative; another place walks; the site is still refused', { timeout: 120000 }, async t => {
  const x = await world(t);
  const refused = await x.act('stroll:field');
  assert.equal(refused.accepted, false); assert.equal(refused.code, 'site.under-construction');
  assert.equal(refused.reason, 'walk1 is under construction; come back when it is finished; to stroll here instead, explore the Green field (wander:here).');
  assert.equal(refused.did_you_mean?.[0]?.id, 'wander:here');
  const cottage = await x.act('walk to the cottage');
  assert.equal(cottage.accepted, true, JSON.stringify(cottage)); assert.equal(cottage.receipt.capability, 'walk:cottage');
  await x.act('stand:here'); await x.settle(2);
  // the thing under construction itself is still refused, in plain words and by id, and the refusal names the alternative
  for (const phrase of ['walk to the walk lighthouse', 'walk:walk-lighthouse', 'go to the walk-lighthouse']) {
    const site = await x.act(phrase);
    t.diagnostic(`${phrase}: ${JSON.stringify({ accepted: site.accepted, code: site.code, reason: site.reason })}`);
    assert.equal(site.accepted, false, phrase); assert.equal(site.code, 'site.under-construction', phrase);
    assert.match(site.reason, /under construction.*; to stroll here instead, explore the Green field \(wander:here\)\.$/, phrase);
  }
});
