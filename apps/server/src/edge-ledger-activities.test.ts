// activities/1 (Gene 2026-10-07: "sit down does nothing", "find somewhere to read a book", "lie down doesnt work"):
// generic native activities, discoverable and reachable in plain words, with the body state the viewer poses.
import test from 'node:test';
import assert from 'node:assert/strict';
import {HUMAN_RADIUS} from '../../../mars/viewer/engine/world/catalog.ts';
import {edenNavWorld, inSolid} from '../test/eden-nav-fixture.ts';

test('activities: sit down, stand, lie down, nap, read (anywhere and in the library), discoverable in observe', {timeout: 900000}, async t => {
  const w = await edenNavWorld(2); t.after(() => {w.f.host.stop(); w.f.db.close();});
  const [a, b] = w.souls, body = (s: typeof a) => w.engine.world.entities[s.entityId], inside: string[] = [];
  const watch = () => {for (const s of w.souls) {const e = body(s); if (!e?.human || e.human.level !== 0) continue; for (const q of w.spec!.solids) if (inSolid(e.pose.p[0], e.pose.p[2], q, HUMAN_RADIUS * 0.5)) inside.push(`${s.name} in ${q.id}`);}};
  const act = async (s: typeof a, capability: string, params?: object) => {const out: any = await w.act(s, capability, params); assert.equal(out.accepted, true, capability + ' ' + JSON.stringify(out)); return out;};
  const done = async (s: typeof a, out: any, limit = 6000, each?: () => void) => {await w.run([{soulId: s.soulId, id: out.receipt.id}], limit, () => {watch(); each?.();}); const r = w.ledger.receipt(s.soulId, out.receipt.id)!; assert.equal(r.phase, 'completed', JSON.stringify(r)); return r;};
  const obs: any = w.ledger.observe(a, new Set());
  for (const id of ['sit:here', 'read:here', 'lie:here', 'nap:here', 'sit-ground:here']) assert.ok(obs.doHere.some((d: any) => d.id === id), 'doHere lists ' + id);
  // to the campfire, then "sit down": the nearest free seat there
  await done(a, await act(a, 'walk:social-eden-fire-circle'));
  // Native region arrival varies with the random Soul identity. Judge the nearest
  // actual free fixture from that arrival, rather than hardcoding one side of the fire.
  const fireSeats = ['social-eden-fire-bench-north', 'social-eden-fire-bench-south'].map(id => {
    const e = w.engine.world.entities[(w.f.host.kernel.things[id]?.traits.entity as string | undefined) ?? id];
    assert.ok(e, 'actual native fire bench ' + id);
    return {id, at: [...e.pose.p], distance: Math.hypot(body(a).pose.p[0] - e.pose.p[0], body(a).pose.p[2] - e.pose.p[2])};
  });
  const fireOffers = w.ledger.capabilities(a).filter(c => fireSeats.some(s => c.id === 'sit:' + s.id));
  const nearest = fireSeats.filter(s => fireOffers.some(c => c.id === 'sit:' + s.id && c.available))
    .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))[0];
  assert.ok(nearest && nearest.distance <= 8, 'an available fire bench is nearby');
  t.diagnostic(JSON.stringify({soulId: a.soulId, arrival: body(a).pose.p, fireSeats, expected: nearest.id}));
  const sit = await act(a, 'sit down', {seconds: 5});
  assert.equal(sit.resolved?.to, 'sit:' + nearest.id, 'ordinary sitting names the nearest available durable fire bench');
  assert.equal(sit.receipt.chosen?.target, nearest.id, 'receipt commits the exact nearest fixture');
  await done(a, sit); assert.equal(body(a).human.activity, 'sit', 'seated on a seat');
  assert.ok(w.engine.nativeSeatHoldsV1(a.entityId).some((h: {slot: string}) => h.slot.startsWith(`${sit.receipt.chosen?.target}#`)), 'the completed receipt holds its exact chosen fixture');
  assert.ok(Math.hypot(body(a).pose.p[0] - 24, body(a).pose.p[2] + 7) < 8, 'by the fire');
  // reading where you are: on that seat with the book you carry
  const here = await act(a, 'find somewhere to read a book', {seconds: 6}); assert.equal(here.resolved?.to, 'read:here');
  let posed: any = null; await done(a, here, 3000, () => {const h = body(a).human; if (h.activity === 'read') posed ??= {base: h.baseActivity, prop: h.prop};});
  assert.deepEqual(posed, {base: 'sit', prop: 'book'}, 'reading seated with a book');
  assert.equal(body(a).human.activity, 'sit', 'still seated afterwards'); assert.equal(body(a).human.prop, undefined);
  await done(a, await act(a, 'stand up'));
  assert.notEqual(body(a).human.activity, 'sit');
  // lie down / nap on open ground
  for (const [words, pose] of [['lie down', 'lie'], ['take a nap', 'nap'], ['sit on the grass', 'sit-ground'], ['dance', 'dance'], ['do some push-ups', 'pushups'], ['jumping jacks', 'jumping-jacks']] as const) {
    const out = await act(a, words, {seconds: 4}); let seen = false;
    await done(a, out, 3000, () => {if (body(a).human.activity === pose) seen = true;});
    assert.ok(seen, `${words} → ${pose}`); assert.equal(body(a).human.activity, 'idle');
  }
  // the library: through the door, a book from the shelf, a reading seat, the book back
  const lib = await act(b, 'read a book in the library', {seconds: 8}); assert.equal(lib.resolved?.to, 'read:eden-library-1');
  const phases: string[] = []; let deepest = 0;
  await done(b, lib, 9000, () => {const e = body(b), h = e.human, tag = `${h.activity}${h.prop ? '+' + h.prop : ''}${h.baseActivity ? '/' + h.baseActivity : ''}`; if (phases.at(-1) !== tag && !['walk', 'idle', 'wait'].includes(h.activity)) phases.push(tag); if (e.pose.p[0] > 69 && e.pose.p[0] < 79 && e.pose.p[2] < -3.2) deepest = Math.min(deepest, e.pose.p[2]);});
  t.diagnostic(JSON.stringify({phases, deepest}));
  assert.ok(phases.includes('browse+book/idle') && phases.includes('read+book/sit'), 'takes a book at the shelf and reads seated: ' + phases.join(' '));
  assert.ok(deepest < -4, 'inside the library');
  // unknown verbs are refused with real things to do
  const no: any = await w.act(a, 'juggle:moon'); assert.equal(no.accepted, false);
  assert.ok(no.did_you_mean.some((d: any) => /:here$/.test(d.id)), JSON.stringify(no.did_you_mean));
  assert.deepEqual(inside.slice(0, 5), []);
  assert.deepEqual(w.f.host.engine.runtime.violations, []);
});
