// READ-DISPLACEMENT (continuity C13, 2026-10-31): finishing a `read` walks the reader back to the shelf's browse point. A
// Soul standing idle there was moved by the native make-way courtesy walk (walk.ts makeWay, `<actor>:make-way:<tick>`):
// no decision on its side and no event, and in C13 that walk took it out of the reading room, so the reader's reply was
// heard only by a fixture occupant. A browse walk is `free: 'goal/1'`: when it begins with another body on its goal, it
// ends at the nearest free standing point within 1.5 m reached straight from the goal (else it is skipped), so a bystander
// is never moved and the reader still puts the book back facing the shelf.
import test from 'node:test';
import assert from 'node:assert/strict';
import {coreAWorld} from '../test/core-a-fixture.ts';

test('a read\'s return browse never moves a Soul standing idle on the shelf point; the reader still ends at the shelf', {timeout: 600000}, async t => {
  const w = await coreAWorld(2), [a, b] = w.souls; t.after(w.close);
  const place = 'eden-library-1';
  for (const s of [a, b]) {
    const go = await w.http(s, 'POST', '/v1/edge/act', {verb: 'go', target: {place}});
    assert.equal(go.body.accepted, true, JSON.stringify(go.body));
    await w.ticks(2400, () => !w.open(s, go.body.receipt.id));
    assert.equal(w.receipt(s, go.body.receipt.id).phase, 'completed', 'initial library walk completes');
  }
  const read = await w.http(b, 'POST', '/v1/edge/act', {verb: 'read', target: {place, seconds: 20}});
  assert.equal(read.body.accepted, true, JSON.stringify(read.body));
  const engine = w.engine as unknown as {programs: Map<string, {actor: string; steps: {verb: string; params: Record<string, unknown>}[]}>; programOf(actor: string): string | null};
  const prog = engine.programs.get(engine.programOf(b.entityId)!)!;
  const walks = prog.steps.filter(s => s.verb === 'walk_to' || s.verb === 'mars:walk_to');
  const last = walks.at(-1)!, shelf: [number, number] = last.verb === 'walk_to' ? last.params.to as [number, number] : [last.params.x as number, last.params.z as number];
  assert.equal(prog.steps.at(-1)!.params.activity, 'browse', 'the plan ends with the return browse');
  // B reads; A (idle) steps onto the very point B's return browse walks to
  await w.ticks(4000, () => w.body(b).human.activity === 'read');
  assert.equal(w.body(b).human.activity, 'read', 'B is reading');
  await w.put(a, shelf); await w.ticks(40);
  const a0 = w.pos(a);
  assert.ok(Math.hypot(a0[0] - shelf[0], a0[1] - shelf[1]) < 0.5, `A stands on the browse point: ${a0} vs ${shelf}`);
  assert.ok(['idle', 'wait'].includes(w.body(a).human.activity), 'A is idle');
  const nudges = new Set<string>(); let drift = 0, browses = 0, prev = '';
  await w.ticks(6000, () => {
    for (const id of w.engine.runtime.records.keys()) if (id.startsWith(a.entityId + ':make-way:')) nudges.add(id);
    const p = w.pos(a); drift = Math.max(drift, Math.hypot(p[0] - a0[0], p[1] - a0[1]));
    const act = w.body(b).human.activity; if (act === 'browse' && prev !== 'browse') browses++; prev = act;
    return !w.open(b, read.body.receipt.id);
  });
  const end = w.pos(b);
  t.diagnostic(JSON.stringify({shelf, a0, drift, nudges: [...nudges], browses, end}));
  assert.equal(w.receipt(b, read.body.receipt.id).phase, 'completed', 'the read completes');
  assert.deepEqual([...nudges], [], 'no make-way walk is submitted for the bystander');
  assert.ok(drift < 0.1, `the bystander is not moved (${drift} m)`);
  assert.equal(browses, 1, 'the return browse still runs once B has read');
  const gap = Math.hypot(end[0] - a0[0], end[1] - a0[1]), off = Math.hypot(end[0] - shelf[0], end[1] - shelf[1]);
  assert.ok(gap >= 0.6, `the reader ends clear of the bystander (${gap} m)`);
  assert.ok(off <= 1.6, `the reader ends at the shelf (${off} m from its browse point)`);
  const room = (q: [number, number]) => w.ledger.places.containing(q[0], q[1], 0)[0]?.id ?? null;
  assert.equal(room(end), room(shelf), 'in the shelf\'s own room');
  assert.deepEqual(w.engine.runtime.violations, []);
  await w.replayExact();
});
