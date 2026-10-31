// READ-DISPLACEMENT (continuity C13, 2026-10-31): finishing a `read` walks the reader back to the shelf's browse point. A
// Soul standing idle there was moved by the native make-way courtesy walk (walk.ts makeWay, `<actor>:make-way:<tick>`):
// no decision on its side and no event, and in C13 that walk took it out of the reading room, so the reader's reply was
// heard only by a fixture occupant. A browse walk is `free: 'goal/1'` (engine freeGoalV1): when it begins with another
// body on its goal it ends at a free standing point within 1.5 m in the shelf's own room whose route keeps clear of every
// body near the goal, or it is skipped and the reader browses where it stands. Either way no bystander is moved.
// Deterministic: the reader is put at a fixed point before it asks to read (its 'go' arrival varies with load).
import test from 'node:test';
import assert from 'node:assert/strict';
import {coreAWorld} from '../test/core-a-fixture.ts';

type V2 = [number, number];
for (const [label, startX] of [['a bystander on the west shelf point', 74], ['a bystander on the east shelf point', 76.5], ['every free point near the reader blocked: the free point lies beyond the bystanders', 74]] as const)
  test(`a read's return browse never moves a Soul standing idle near the shelf (${label}); the reader ends clear, in the shelf's room`, {timeout: 600000}, async t => {
    const w = await coreAWorld(4), [a, b, c, d] = w.souls; t.after(w.close);
    const place = 'eden-library-1', beyond = label.startsWith('every');
    for (const s of [a, b, c, d]) {
      const go = await w.http(s, 'POST', '/v1/edge/act', {verb: 'go', target: {place}});
      assert.equal(go.body.accepted, true, JSON.stringify(go.body));
      await w.ticks(2400, () => !w.open(s, go.body.receipt.id));
      assert.equal(w.receipt(s, go.body.receipt.id).phase, 'completed', 'initial library walk completes');
    }
    // fixed starting points: the reader in the reading room, the others out of its way until placed
    await w.put(a, [72, -10]); await w.put(c, [76, -10]); await w.put(d, [74, -10]); await w.ticks(20);
    await w.put(b, [startX, -6.5]); await w.ticks(40);
    assert.ok(Math.hypot(w.pos(b)[0] - startX, w.pos(b)[1] + 6.5) < 1, `the reader starts where placed: ${w.pos(b)}`);
    const read = await w.http(b, 'POST', '/v1/edge/act', {verb: 'read', target: {place, seconds: 20}});
    assert.equal(read.body.accepted, true, JSON.stringify(read.body));
    const engine = w.engine as unknown as {programs: Map<string, {steps: {verb: string; params: Record<string, unknown>}[]}>; programOf(actor: string): string | null};
    const prog = engine.programs.get(engine.programOf(b.entityId)!)!;
    const last = prog.steps.filter(s => s.verb === 'walk_to' || s.verb === 'mars:walk_to').at(-1)!;
    const shelf: V2 = last.verb === 'walk_to' ? last.params.to as V2 : [last.params.x as number, last.params.z as number];
    assert.equal(last.params.free, 'goal/1', 'the return browse walk is free-goal');
    assert.ok(Array.isArray(last.params.freeWithin), 'and names its room');
    assert.equal(prog.steps.at(-1)!.params.activity, 'browse', 'the plan ends with the return browse');
    await w.ticks(4000, () => w.body(b).human.activity === 'read');
    assert.equal(w.body(b).human.activity, 'read', 'B is reading');
    const seat = w.pos(b);
    // A steps onto the very point B's return browse walks to. Third case (the west shelf point lies in the 0.6 m gap between
    // the wall and a table, the reader seated north of the table): C and D stand on the open floor north of A, so the only
    // free standing point within 1.5 m lies south of A, beyond it down that gap. Walking there past A would fire the
    // make-way; the reader must go round, or browse where it read.
    await w.put(a, shelf);
    const extra: [typeof c, V2][] = beyond ? [[c, [70.7, -5]], [d, [71.6, -4.9]]] : [];
    if (beyond) assert.ok(Math.hypot(shelf[0] - 70.1, shelf[1] + 6) < 0.05 && Math.hypot(seat[0] - 71.5, seat[1] + 5.75) < 0.2, `the fixed reader start reads by the west shelf: ${shelf} ${seat}`);
    for (const [s, at] of extra) await w.put(s, at);
    await w.ticks(40);
    for (const [s, at] of extra) assert.ok(Math.hypot(w.pos(s)[0] - at[0], w.pos(s)[1] - at[1]) < 0.2, `${s.name} stands where placed: ${w.pos(s)} vs ${at}`);
    const by = [a, ...extra.map(x => x[0])], at0 = new Map(by.map(s => [s.soulId, w.pos(s)]));
    assert.ok(Math.hypot(w.pos(a)[0] - shelf[0], w.pos(a)[1] - shelf[1]) < 0.5, `A stands on the browse point: ${w.pos(a)} vs ${shelf}`);
    for (const s of by) assert.ok(['idle', 'wait'].includes(w.body(s).human.activity), `${s.name} is idle`);
    // make-way records already there (the four 'go' arrivals in a busy library may nudge one another) are not this read's
    const before = new Set(w.engine.runtime.records.keys()), tick0 = w.engine.world.tick, earlier = [...before].filter(id => id.includes(':make-way:'));
    const nudges = new Set<string>(), drift = new Map(by.map(s => [s.soulId, 0])); let browses = 0, prev = '';
    await w.ticks(6000, () => {
      for (const id of w.engine.runtime.records.keys()) if (!before.has(id) && id.includes(':make-way:') && by.some(s => id.startsWith(s.entityId + ':'))) nudges.add(id);
      for (const s of by) {const p = w.pos(s), p0 = at0.get(s.soulId)!; drift.set(s.soulId, Math.max(drift.get(s.soulId)!, Math.hypot(p[0] - p0[0], p[1] - p0[1])));}
      const act = w.body(b).human.activity; if (act === 'browse' && prev !== 'browse') browses++; prev = act;
      return !w.open(b, read.body.receipt.id);
    });
    const end = w.pos(b), room = (q: V2) => w.ledger.places.containing(q[0], q[1], 0)[0]?.id ?? null, off = Math.hypot(end[0] - shelf[0], end[1] - shelf[1]), skipped = off > 1.6;
    t.diagnostic(JSON.stringify({tick0, earlier, shelf, seat, by: [...at0.values()], drift: [...drift.values()], nudges: [...nudges], browses, end, off, skipped, rooms: [room(end), room(shelf)]}));
    assert.equal(w.receipt(b, read.body.receipt.id).phase, 'completed', 'the read completes');
    assert.deepEqual([...nudges], [], 'no make-way walk is submitted for a bystander');
    for (const [id, d] of drift) assert.ok(d < 0.1, `bystander ${id} is not moved (${d} m)`);
    assert.equal(browses, 1, 'the return browse still runs once B has read');
    for (const p of at0.values()) assert.ok(Math.hypot(end[0] - p[0], end[1] - p[1]) >= 0.6, `the reader ends clear of the bystanders (${end} vs ${p})`);
    // the reader ends at the shelf in its room, or (no free point with a clear way) browses where it read
    if (skipped) assert.ok(Math.hypot(end[0] - seat[0], end[1] - seat[1]) < 0.3, `a skipped browse walk leaves the reader where it read (${end} vs ${seat})`);
    assert.equal(room(end), room(shelf), 'in the shelf\'s own room');
    assert.deepEqual(w.engine.runtime.violations, []);
    await w.replayExact();
  });
