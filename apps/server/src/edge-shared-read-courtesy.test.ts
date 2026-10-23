// BROWSE-COURTESY (2026-10-23): a full invited shared read (shelf browse, read, return browse) for two native bodies in the
// same library, the host never stood up or moved by the test. Live386 lost a body with pose.not-still after a courtesy step
// aside. Where the guest waits decides the race (before the fix): at [70.5,-5.5] a make-way nudge lands on the host the tick
// its shelf walk ends, so its browse was refused pose.not-still; at [70.6,-6.2] and [71.5,-7.45] the guest's walk nudged the
// host's first or return browse (pose.moved). Both receipts must complete with both bodies reading the requested 60 s,
// at the same time, in one actual room (innermost place holding each body's pose and level), at most 4 m apart. While both
// read, the stall guard's native probe must not take a live seated pose_v1 hold (pose:<actor>, seatHeight) for a stalled one:
// gate 1de493c48 released both readers every ~29 s and set them down 1 m away (one crossed into the reading corner).
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
    const both: {room: (string | null)[]; level: number[]; gap: number}[] = [];
    const falseStall: string[] = [], held = new Map<string, number>(), drift = new Map<string, number>(runs.map(([s]) => [s.soulId, 0]));
    const at0 = new Map<string, [number, number]>();
    await w.ticks(8000, () => {
      for (const [s] of runs) if (w.body(s).human.activity === 'read') reading.get(s.soulId)!.push(w.engine.world.tick);
      // together: both bodies natively reading this tick, located by their actual pose and level (innermost place polygon)
      if (runs.every(([s]) => w.body(s).human.activity === 'read')) {
        const [pa, pb] = runs.map(([s]) => w.body(s)), room = (e: typeof pa) => w.ledger.places.containing(e.pose.p[0], e.pose.p[2], e.human.level ?? 0)[0]?.id ?? null;
        for (const [s] of runs) {
          const e = w.body(s), rt = (w.engine as unknown as {rt: {holder: (r: string) => string[]; isActive: (id: string) => boolean}}).rt;
          const live = rt.holder('pose:' + s.entityId).filter(id => rt.isActive(id)), q = w.engine.stallProbeV1!(s.entityId)!;
          if (live.length) held.set(s.soulId, (held.get(s.soulId) ?? 0) + 1);
          if (live.length && q.candidate && falseStall.length < 3) falseStall.push(JSON.stringify({who: s.name, tick: w.engine.world.tick, markers: q.markers, holders: q.holders.length, pose: live}));
          const p0 = at0.get(s.soulId) ?? [e.pose.p[0], e.pose.p[2]]; at0.set(s.soulId, p0);
          drift.set(s.soulId, Math.max(drift.get(s.soulId)!, Math.hypot(e.pose.p[0] - p0[0], e.pose.p[2] - p0[1])));
        }
        both.push({room: [room(pa), room(pb)], level: [pa.human.level ?? 0, pb.human.level ?? 0], gap: Math.hypot(pa.pose.p[0] - pb.pose.p[0], pa.pose.p[2] - pb.pose.p[2])});
      }
      for (const id of w.engine.runtime.records.keys()) if (id.includes(':make-way:') && runs.some(([s]) => id.startsWith(s.entityId + ':'))) nudges.add(id);
      return runs.every(([s, id]) => !w.open(s, id));
    });
    const out = runs.map(([s, id]) => {
      const rec = w.receipt(s, id), ticks = reading.get(s.soulId)!;
      return {who: s.name, phase: rec.phase, code: rec.code, readSeconds: ticks.length / 20, readSpan: ticks.length ? (ticks.at(-1)! - ticks[0] + 1) / 20 : 0};
    });
    const rooms = [...new Set(both.flatMap(x => x.room))], gaps = both.map(x => x.gap);
    const together = {overlapSeconds: both.length / 20, rooms, levels: [...new Set(both.flatMap(x => x.level))], minGap: Math.min(...gaps), maxGap: Math.max(...gaps)};
    const stall = {falseCandidates: falseStall, heldTicks: [...held.values()], maxDrift: [...drift.values()].map(d => Math.round(d * 1000) / 1000)};
    t.diagnostic(JSON.stringify({out, nudges: nudges.size, together, stall}));
    for (const o of out) {
      assert.equal(o.phase, 'completed', `${o.who}'s shared read receipt completes (${o.code})`);
      assert.ok(o.readSeconds >= 55 && o.readSpan <= 90, `${o.who} natively reads the requested 60 s (read ${o.readSeconds}s over ${o.readSpan}s)`);
    }
    assert.ok(together.overlapSeconds >= 55, `both bodies natively read at the same time for the requested 60 s (${together.overlapSeconds}s)`);
    assert.ok(rooms.length === 1 && rooms[0] !== null && together.levels.length === 1, `both read in one actual room on one level: ${JSON.stringify(together)}`);
    assert.ok(together.maxGap <= 4, `both readers within 4 m of each other throughout (max ${together.maxGap.toFixed(2)} m)`);
    assert.equal(stall.heldTicks.length, 2, 'both readers hold a live pose_v1 while reading (the case under test)');
    assert.deepEqual(falseStall, [], 'a live seated reading pose is never a stall candidate');
    assert.ok(stall.maxDrift.every(d => d <= 0.05), `neither reader is relocated while reading (max drift ${stall.maxDrift} m)`);
  });

test('shared read guest spot: own free spot beside the host destination (same room, 0.5-4 m), never the host\'s own, unavailable, far, other-room, other-level, level-aware or unknown-room spots', async t => {
  const w = await coreAWorld(3), [a, b, c] = w.souls; t.after(w.close);
  const host = await w.http(a, 'POST', '/v1/edge/act', {verb: 'read', target: {place: 'eden-library-1', seconds: 60, with: b.name}});
  assert.equal(host.body.accepted, true, JSON.stringify(host.body));
  const inv = w.ledger.together.invitesFor(b.soulId)[0], at = inv.meetAt!; assert.ok(at, 'the read invitation carries the host destination');
  const level = w.body(a).human.level ?? 0, room = (q: [number, number]) => w.ledger.places.containing(q[0], q[1], level)[0]?.id, hostRoom = room(at);
  // probe points by actual room membership: one 1.7 m away in the host's room, one < 4 m away in another room
  const ring = (r: number, same: boolean) => {for (let k = 0; k < 36; k++) {const q: [number, number] = [Math.round((at[0] + r * Math.cos(k * Math.PI / 18)) * 100) / 100, Math.round((at[1] + r * Math.sin(k * Math.PI / 18)) * 100) / 100]; if ((room(q) === hostRoom) === same) return q;} return undefined;};
  const beside = ring(1.7, true)!, other = [1, 2, 3, 3.9].map(r => ring(r, false)).find(Boolean); assert.ok(beside);
  const plan = (to: [number, number], seconds = 180) => ({label: 'Read', steps: [{verb: 'walk_to', params: {to: [to[0] + 2, to[1]]}}, {verb: 'mars:pose_v1', params: {activity: 'browse', seconds: 4}}, {verb: 'walk_to', params: {to}}, {verb: 'mars:pose_v1', params: {activity: 'read', seconds}}, {verb: 'mars:pose_v1', params: {activity: 'browse', seconds: 3}}]});
  const spot = (id: string, available = true) => ({id, verb: 'read', label: id, available, target: {id, kind: 'spot' as const}});
  const placeCap = {id: inv.capability, verb: 'read', label: 'Read in the library', available: true, target: {id: 'eden-library-1', kind: 'place' as const}};
  const pick = (spots: [string, [number, number], boolean?][], soul = b) => {
    const caps = [placeCap, ...spots.map(([id, , av]) => spot(id, av ?? true))], plans = new Map([[placeCap.id, plan([at[0] + 5, at[1]])], ...spots.map(([id, to]) => [id, plan(to)] as const)]);
    const r = w.ledger.together.acceptPlan(soul, inv.id, caps, plans); if (!('steps' in r)) return r;
    const read = r.steps.find(s => s.params.activity === 'read')!, mv = r.steps[r.steps.indexOf(read) - 1];
    return {to: mv.params.to as [number, number], seconds: read.params.seconds, browses: r.steps.filter(s => s.params.activity === 'browse').map(s => s.params.seconds)};
  };
  const far: [number, number] = [beside[0] + (beside[0] - at[0]) * 1.7, beside[1] + (beside[1] - at[1]) * 1.7], own: [number, number] = [at[0] + 0.2, at[1]];
  const chosen = pick([['read:host-own', own], ['read:far', far], ['read:beside', beside]]) as {to: [number, number]; seconds: number; browses: number[]};
  assert.deepEqual(chosen.to, beside, 'the free spot beside the host, not its own spot or one across the room');
  assert.equal(chosen.seconds, 60, 'the invited duration'); assert.deepEqual(chosen.browses, [4, 3], 'native browse durations kept');
  const fallback = {to: [at[0] + 5, at[1]], seconds: 60, browses: [4, 3]};
  assert.deepEqual(pick([['read:beside', beside, false]]), fallback, 'an unavailable (taken) spot is never chosen: the place plan as before');
  assert.deepEqual(pick([['read:far', far], ['read:host-own', own]]), fallback, 'only far or host-own spots: the place plan as before');
  if (other) assert.deepEqual(pick([['read:other-room', other]]), fallback, 'a near spot in another room is never chosen');
  // fail closed (scope: ground-level plain walk_to plans only): a level-aware or levelled plan, a level-aware default place
  // plan, an upper-floor host or guest, or a host destination in no known room never wins; the place plan as before
  const levelled = (to: [number, number], mars: boolean) => {const pl = plan(to); pl.steps[2] = mars ? {verb: 'mars:walk_to', params: {x: to[0], z: to[1], level: 0}} as never : {verb: 'walk_to', params: {to, level: 0}} as never; return pl;};
  for (const mars of [true, false]) {
    const caps = [placeCap, spot('read:beside')], plans = new Map([[placeCap.id, plan([at[0] + 5, at[1]])], ['read:beside', levelled(beside, mars)]]);
    const r = w.ledger.together.acceptPlan(b, inv.id, caps, plans) as {steps: {verb: string; params: Record<string, unknown>}[]};
    assert.deepEqual(r.steps.find(s => s.verb === 'walk_to' && Array.isArray(s.params.to) && (s.params.to as number[])[0] === at[0] + 5)?.params.to, [at[0] + 5, at[1]], `a ${mars ? 'mars:walk_to' : 'levelled walk_to'} spot plan does not win`);
  }
  const sb = (w.ledger.together as unknown as {spotBeside: (...a: unknown[]) => unknown}).spotBeside.bind(w.ledger.together);
  const caps = [placeCap, spot('read:beside')], plans = (home = plan([at[0] + 5, at[1]])) => new Map([[placeCap.id, home], ['read:beside', plan(beside)]]);
  assert.ok(sb(at, 0, 0, 'read', placeCap.id, caps, plans()), 'ground case: the beside spot (direct)');
  assert.equal(sb(at, 1, 0, 'read', placeCap.id, caps, plans()), undefined, 'host on another level: no override');
  assert.equal(sb(at, 0, 1, 'read', placeCap.id, caps, plans()), undefined, 'guest on another level: no override');
  assert.equal(sb(at, 0, 0, 'read', placeCap.id, caps, plans(levelled([at[0] + 5, at[1]], true))), undefined, 'level-aware default place plan: no override');
  const nowhere: [number, number] = [at[0] + 5000, at[1] + 5000];
  assert.equal(w.ledger.places.containing(nowhere[0], nowhere[1], 0).filter(p => p.parent !== null).length, 0, 'probe point lies in no room');
  assert.equal(sb(nowhere, 0, 0, 'read', placeCap.id, [placeCap, spot('read:n')], new Map([[placeCap.id, plan([nowhere[0] + 5, nowhere[1]])], ['read:n', plan([nowhere[0] + 1.7, nowhere[1]])]])), undefined, 'unknown room (world root only): no override');
  t.diagnostic(JSON.stringify({at, hostRoom, beside, far, other: other ? [other, room(other)] : null}));
  assert.equal((pick([['read:beside', beside]], c) as {code: string}).code, 'invite.gone', 'an uninvited soul still cannot accept');
});
