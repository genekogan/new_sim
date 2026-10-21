// nav-connect/1 (lane NAV, 2026-10-20): no god edit leaves a Soul unable to walk. An edit that closes a Soul into a
// pocket steps it to open ground (a logged edge-relocate the replay folds); things the edit leaves with no walk to them
// are named to the god in one line; a big separate area (an island, a walled quarter) is a place, not a trap.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { fixture, invite, accept, factory } from '../../test/native-owner-fixture.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
function world(t: TestContext) {
  const w = fixture(':memory:', factory, { durableClockV1: true }); w.brain.quiesce();
  const god = new GodMode(w.db, { worldId: w.host.worldId, ownerId: 'owner', tick: () => w.host.engine.world.tick, now: () => 1_000_000, emit() {} });
  const edge = new EdgeLedger(w.host, w.db); installEngineBridge({ host: w.host, god, edge, log() {}, worldClock: false, worldLore: false });
  const token = god.mintFor({ id: 'owner', role: 'user' }, 'builder'); god.godIdentity(token);
  t.after(() => { w.brain.quiesce(); w.host.stop(); edge.comms?.close(); w.db.close(); });
  const settle = async (n = 3) => { for (let i = 0; i < n; i++) { w.host.tickOnce(); await setImmediate(); w.host.drainInputs(); } };
  return { ...w, god, settle, ledger: edge, E: w.host.engine as any };
}
const box = (name: string, x: number, z: number) => ({ schema: 'def/1', name, version: 1, layer: 'solid', size: { box: [x, 3, z] }, make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, 1.5, 0], size: [x, 3, z] }] } } });
/** Four walls round c, inner side `s` m: the east/west walls are long, the north/south ones stop 5 cm short of them
 *  (solids may not overlap; no gap a body fits through). Defines its own two wall defs. */
function ring(c: [number, number], s: number, tag: string) {
  const h = s / 2 + 0.5;
  return [{ op: 'define', def: box(`${tag}long`, s + 2, 1) }, { op: 'define', def: box(`${tag}short`, s - 0.1, 1) },
    { op: 'place', def: `${tag}short@1`, name: `${tag}n`, p: [c[0], c[1] + h] }, { op: 'place', def: `${tag}short@1`, name: `${tag}s`, p: [c[0], c[1] - h] },
    { op: 'place', def: `${tag}long@1`, name: `${tag}e`, p: [c[0] + h, c[1]], r: Math.PI / 2 }, { op: 'place', def: `${tag}long@1`, name: `${tag}w`, p: [c[0] - h, c[1]], r: Math.PI / 2 }];
}

test('walls built round a Soul: it steps to open ground (logged, nav-connect/1) and the god hears of it once', async t => {
  const w = world(t); await w.settle(1);
  await invite(w, 'ana'); const row: any = await accept(w.host, w.souls.create('dev:ana', { name: 'Ana', description: 'curious' })); await w.settle(8);
  // away from the arrival point (the main area is the one holding it)
  const b0 = w.host.engine.world.entities[row.entity_id]!; assert.equal(w.E.relocateHumanV1(row.entity_id, [b0.pose.p[0] + 20, b0.pose.p[2]]), true); await w.settle(2);
  const b = w.host.engine.world.entities[row.entity_id]!, at: [number, number] = [b.pose.p[0], b.pose.p[2]];
  const crate = box('crate', 0.6, 0.6);
  const r0: any = w.god.act({ ops: [{ op: 'define', def: crate }, { op: 'place', def: 'crate@1', name: 'crate', p: [at[0] + 2, at[1] + 2] }] });
  assert.equal(r0.accepted, true, JSON.stringify(r0.failures)); await w.settle(2);
  assert.equal(w.E.navCheckV1([{ id: 'ana', p: at, level: 0 }])[0].ok, true, 'open ground before');
  const r: any = w.god.act({ ops: ring(at, 7, 'r') });
  assert.equal(r.accepted, true, JSON.stringify(r.failures));
  assert.ok(r.warnings.some((x: string) => /^1 Soul cut off by this edit stepped to open ground nearby\.$/.test(x)), JSON.stringify(r.warnings));
  const named = r.warnings.filter((x: string) => x.startsWith('No walk reaches'));
  assert.equal(named.length, 1, JSON.stringify(r.warnings)); assert.match(named[0], /\bcrate\b/);
  await w.settle(3);
  const p = w.host.engine.world.entities[row.entity_id]!.pose.p;
  assert.ok(Math.max(Math.abs(p[0] - at[0]), Math.abs(p[2] - at[1])) > 4.5, `outside the walls: ${p}`);
  assert.equal(w.E.navCheckV1([{ id: 'ana', p: [p[0], p[2]], level: 0 }])[0].ok, true, 'on the main area now');
  const ev = w.db.events(w.host.worldId).filter((e: any) => e.kind === 'edge-relocate' && e.payload.policy === 'nav-connect/1');
  assert.equal(ev.length, 1, 'one logged step'); assert.ok(Array.isArray(ev[0].payload.to) && /nav-connect\/1/.test(ev[0].payload.why));
  // an edit near the same pocket names the crate no more (said once), and moves nobody
  const again: any = w.god.act({ ops: [{ op: 'place', def: 'crate@1', name: 'crate2', p: [at[0] + 6, at[1] + 6] }] });
  assert.equal(again.warnings.some((x: string) => x.startsWith('No walk reaches') || /Soul/.test(x)), false, JSON.stringify(again.warnings));
});

test('the engine rescue target: a pocket gets one; open ground and an area above the size limit do not', async t => {
  const w = world(t); await w.settle(1);
  await invite(w, 'ben'); const row: any = await accept(w.host, w.souls.create('dev:ben', { name: 'Ben', description: 'calm' })); await w.settle(8);
  // away from the arrival point (the main area is the one holding it); the fixture world is 60 m across
  const b0 = w.host.engine.world.entities[row.entity_id]!; assert.equal(w.E.relocateHumanV1(row.entity_id, [b0.pose.p[0] + 15, b0.pose.p[2]]), true); await w.settle(2);
  const b = w.host.engine.world.entities[row.entity_id]!, at: [number, number] = [b.pose.p[0], b.pose.p[2]];
  assert.equal(w.E.navRescueV1(row.entity_id), null, 'connected: no rescue');
  // the hook off, so the engine read alone is under test (as when the edit came from elsewhere)
  (w.god as any).bodies.navNote = undefined;
  const r: any = w.god.act({ ops: ring(at, 5, 'y') }); assert.equal(r.accepted, true, JSON.stringify(r.failures)); await w.settle(1);
  const v = w.E.navCheckV1([{ id: 'ben', p: at, level: 0 }])[0]; assert.equal(v.ok, false); assert.ok(v.pocket > 10 && v.pocket < 25, String(v.pocket));
  assert.equal(w.E.navRescueV1(row.entity_id, Infinity, 10), null, 'a separate area above the size limit is a place, not a trap');
  const res = w.E.navRescueV1(row.entity_id, Infinity);
  assert.ok(res && res.code === 'nav.disconnected' && res.level === 0, JSON.stringify(res));
  assert.ok(Math.hypot(res.to[0] - at[0], res.to[1] - at[1]) > 3, 'outside the walls');
  assert.equal(w.E.navCheckV1([{ id: 'to', p: res.to, level: 0 }])[0].ok, true, 'on the main area');
});

test('a Soul already cut off (an edit the hook did not see) steps out when its walk is refused, then walks', async t => {
  const w = world(t); await w.settle(1);
  const edge = (w.god as any).bodies && (w as any).edge;
  await invite(w, 'cy'); const row: any = await accept(w.host, w.souls.create('dev:cy', { name: 'Cy', description: 'calm' })); await w.settle(8);
  const s = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
  const b0 = w.host.engine.world.entities[row.entity_id]!; assert.equal(w.E.relocateHumanV1(row.entity_id, [b0.pose.p[0] + 15, b0.pose.p[2]]), true); await w.settle(2);
  const at: [number, number] = [w.host.engine.world.entities[row.entity_id]!.pose.p[0], w.host.engine.world.entities[row.entity_id]!.pose.p[2]];
  const crate: any = w.god.act({ ops: [{ op: 'define', def: box('crate', 0.6, 0.6) }, { op: 'place', def: 'crate@1', name: 'crate', p: [at[0] - 20, at[1] + 5] }] }); assert.equal(crate.accepted, true);
  (w.god as any).bodies.navNote = undefined;
  const r: any = w.god.act({ ops: ring(at, 5, 'z') }); assert.equal(r.accepted, true, JSON.stringify(r.failures)); await w.settle(3);
  assert.equal(w.E.navCheckV1([{ id: 'cy', p: at, level: 0 }])[0].ok, false, 'cut off');
  const out: any = await accept(w.host, w.ledger.act(s as any, { capability: 'walk:crate' }));
  assert.equal(out.accepted, true, JSON.stringify(out));
  const ev = w.db.events(w.host.worldId).filter((e: any) => e.kind === 'edge-relocate' && e.payload.policy === 'nav-connect/1');
  assert.equal(ev.length, 1, 'one logged step out'); assert.match(ev[0].payload.why, /nav-connect\/1: stood cut off \(nav\.disconnected\)/);
  void edge;
});
