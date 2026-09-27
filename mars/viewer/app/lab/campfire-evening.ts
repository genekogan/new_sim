// Engine Lab preset "campfire-evening" (milestone H, inhabited scenes): the social verbs of
// engine/social/ on the proving ground's open south-west ground, driven by a timed script of
// direct submits (like engine/test/social.test.ts). HYPOTHETICAL / illustrative: the fixtures,
// people and timings are invented to exercise the verbs, not reconstructed from Mars evidence.
// Pure TS (no three.js/DOM) so node can run it.
import { Runtime } from '../../engine/runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../../engine/runtime/invariants.ts';
import { Spatial } from '../../engine/spatial/service.ts';
import { provingGround } from '../../engine/scenes/proving-ground.ts';
import { emptyWorld, human, addAll, FIXTURE } from '../../engine/world/factory.ts';
import { walkTo } from '../../engine/locomotion/walk.ts';
import { angleDelta, heading, type Vec2 } from '../../engine/core/math.ts';
import { HUMAN_RADIUS } from '../../engine/world/catalog.ts';
import { SOCIAL_ACTIONS, releaseForDirective } from '../../engine/social/actions.ts';
import { fixtureSlots, pointInPolygon, type Slot } from '../../engine/social/slots.ts';
import type { ActionDef, ActionRecord } from '../../engine/actions/types.ts';
import type { Entity } from '../../engine/world/types.ts';
import type { Check, Scenario } from './scenarios.ts';

export const FIRE: Vec2 = [-22, -22.5];
const polar = (r: number, deg: number): Vec2 => [FIRE[0] + r * Math.cos((deg * Math.PI) / 180), FIRE[1] + r * Math.sin((deg * Math.PI) / 180)];
/** Seat fixtures face local +z (seat yaw = entity yaw + π/2); aim a fixture at the fire. */
const facingFire = (p: Vec2) => heading([FIRE[0] - p[0], FIRE[1] - p[1]]) - Math.PI / 2;
/** Where the 2 ambient wanderers stroll (north-east of the fire, beyond the chairs). */
export const WANDER: [number, number][] = [[-20.5, -18.4], [-16, -18.4], [-16, -14.2], [-20.5, -14.2]];
const CONVERSE_AT: Vec2 = [-16.5, -26.5];
const PULL_TO: Vec2 = [-16.5, -20.8];
export const END_S = 75;

function fixture(id: string, defId: string, p: Vec2, yaw: number, obstacle = false): Entity {
  return { id, def: defId, kind: 'fixture', label: id, pose: { p: [p[0], 0, p[1]], yaw }, provenance: FIXTURE, ...(obstacle ? { phase: 'installed' as const, support: { kind: 'ground' as const } } : {}) };
}

function entities(): Entity[] {
  const chairs = [40, 62, 84].map((a, i) => { const p = polar(3.3, a); return fixture(`chair${i + 1}`, 'camp-chair', p, facingFire(p)); });
  const b1 = polar(3.3, -90), b2 = polar(3.4, 180);
  return [
    fixture('fire', 'campfire', FIRE, 0, true),
    fixture('bench1', 'bench-6ft', b1, facingFire(b1)),
    fixture('bench2', 'bench-6ft', b2, facingFire(b2)),
    ...chairs,
    // the fire circle (arrive from the east / south-east)
    human('g1', -15, -22.5, { yaw: Math.PI }), human('g2', -15.2, -24.3), human('g3', -16, -20.9), human('g4', -14.6, -25.7),
    human('g5', -26.5, -18.5), human('g6', -24.6, -17.4),
    // the conversation pair
    human('c1', -15.0, -29.2), human('c2', -16.4, -29.4),
    // the two sitters (near the chairs)
    human('s1', -17.6, -17.5), human('s2', -20.2, -16.7),
    // ambient wanderers
    human('a1', -18.8, -15.4), human('a2', -16.8, -16.2),
    // latecomers: x1 takes the last fire place, x2 finds the circle full
    human('x1', -12, -19.0, { yaw: Math.PI }), human('x2', -12, -24.5, { yaw: Math.PI }),
  ];
}

export type ScriptEvent = { at: number; id: string; label: string; run: (rt: Runtime, s: Script) => ActionRecord[] };
export type Fired = { id: string; label: string; tick: number; recs: ActionRecord[]; cancelled?: string[] };
export type Script = { fired: Fired[]; next: number; notes: { tick: number; level: 'warn' | 'error'; text: string }[] };
const scripts = new WeakMap<Runtime, Script>();
export const scriptOf = (rt: Runtime) => scripts.get(rt);
const rec = (s: Script, id: string) => s.fired.find((f) => f.id === id);

const GATHER = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'];
export const EVENTS: ScriptEvent[] = [
  { at: 0, id: 'gather', label: 'gather g1–g6 → fire circle', run: (rt) => [rt.submit('gather', { actors: GATHER, fixture: 'fire' })] },
  { at: 0, id: 'converse', label: 'converse c1 + c2', run: (rt) => [rt.submit('converse', { actors: ['c1', 'c2'], at: CONVERSE_AT })] },
  { at: 0, id: 'sit-s1', label: 'sit s1 → chair1', run: (rt) => [rt.submit('sit', { actor: 's1', fixture: 'chair1' })] },
  { at: 0, id: 'sit-s2', label: 'sit s2 → chair2', run: (rt) => [rt.submit('sit', { actor: 's2', fixture: 'chair2' })] },
  { at: 0, id: 'ambient', label: 'ambient_wander a1 + a2', run: (rt) => [rt.submit('ambient_wander', { actors: ['a1', 'a2'], region: 'sw-lawn', seed: 3 })] },
  {
    at: 40,
    id: 'join',
    label: 's1 stands, take_slot → fire',
    run: (rt) => [rt.submit('stand', { actor: 's1' }), rt.submit('take_slot', { actor: 's1', owner: 'fire' })],
  },
  { at: 42, id: 'x1', label: 'x1 take_slot → fire (last place)', run: (rt) => [rt.submit('take_slot', { actor: 'x1', owner: 'fire' })] },
  {
    at: 50,
    id: 'full',
    label: 'x2 → full circle (conflict expected)',
    run: (rt) => {
      const held = fixtureSlots(rt, rt.world.entities.fire).find((q) => q.claimedBy);
      return [rt.submit('take_slot', { actor: 'x2', owner: 'fire' }), rt.submit('take_slot', { actor: 'x2', slot: held?.id ?? 'fire#ring0' })];
    },
  },
  { at: 51, id: 'bench', label: 'x2 sits on bench1 instead', run: (rt) => [rt.submit('sit', { actor: 'x2', fixture: 'bench1' })] },
  {
    at: 54,
    id: 'pull',
    label: 'director: releaseForDirective(g1) + walk_to',
    run: (rt, s) => {
      const cancelled = releaseForDirective(rt, 'g1');
      const r = rt.submit('walk_to', { actor: 'g1', x: PULL_TO[0], z: PULL_TO[1] });
      s.fired.push({ id: 'pull-release', label: `released ${cancelled.join(', ')}`, tick: rt.tick, recs: [], cancelled });
      return [r];
    },
  },
];

function fire(rt: Runtime, s: Script) {
  while (s.next < EVENTS.length && rt.tick >= Math.round(EVENTS[s.next].at * 20)) {
    const e = EVENTS[s.next++];
    const recs = e.run(rt, s);
    s.fired.push({ id: e.id, label: e.label, tick: rt.tick, recs });
    for (const r of recs)
      if (r.status === 'failed') {
        const expected = e.id === 'full';
        s.notes.push({ tick: rt.tick, level: expected ? 'warn' : 'error', text: `${expected ? 'EXPECTED ' : ''}${r.verb} ${r.id} failed ${r.diagnostic?.code}: ${r.diagnostic?.message}` });
      }
  }
}

export function campfireRuntime(): Runtime {
  const base = provingGround();
  const w = addAll(emptyWorld('proving-ground', base), ...entities());
  w.regions['sw-lawn'] = { id: 'sw-lawn', label: 'south-west lawn', kind: 'place', polygon: WANDER, provenance: FIXTURE };
  const reg = new Map<string, ActionDef>([[walkTo.verb, walkTo], ...SOCIAL_ACTIONS.map((a) => [a.verb, a] as [string, ActionDef])]);
  const rt = new Runtime(w, reg, { spatial: new Spatial(base) }, DEFAULT_INVARIANTS);
  scripts.set(rt, { fired: [], next: 0, notes: [] });
  return rt;
}

const p2 = (rt: Runtime, id: string): Vec2 => [rt.world.entities[id].pose.p[0], rt.world.entities[id].pose.p[2]];
const yawOf = (rt: Runtime, id: string) => rt.world.entities[id].pose.yaw;
const act = (rt: Runtime, id: string) => rt.world.entities[id].human!.activity;
const reached = (r: ActionRecord | undefined, phase: string) => !!r && r.history.some((h) => h.phase === phase);
const d2 = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const fmtDeg = (r: number) => `${((Math.abs(r) * 180) / Math.PI).toFixed(1)}°`;

/** Someone occupying `slot`: on it (< 5 cm) and facing its heading (< 0.2 rad). */
function onSlot(rt: Runtime, id: string, slot: Slot | undefined) {
  if (!slot) return { ok: false, why: 'no slot' };
  const d = d2(p2(rt, id), slot.p), a = angleDelta(yawOf(rt, id), slot.yaw);
  return { ok: d < 0.05 && Math.abs(a) < 0.2, why: `${d.toFixed(2)} m off, ${fmtDeg(a)} off its heading` };
}

export function campfireChecks(rt: Runtime): Check[] {
  const s = scripts.get(rt)!;
  const kids = (r?: ActionRecord) => (r ? [...rt.records.values()].filter((k) => k.parent === r.id) : []);
  const ring = fixtureSlots(rt, rt.world.entities.fire);
  const heldBy = (actionId: string) => ring.find((q) => q.claimedBy === actionId);
  const out: Check[] = [];
  /** Checks of events still ahead read "pending" rather than as a failure mid-run. */
  const pend = (id: string) => (rec(s, id) ? '' : `(pending: scripted at ${EVENTS.find((e) => e.id === id)!.at} s) `);
  const g = rec(s, 'gather')?.recs[0];
  const gk = kids(g);
  out.push({ ok: gk.length === 6 && gk.every((k) => reached(k, 'occupied')), message: `gather: all 6 took a fire place (${gk.filter((k) => reached(k, 'occupied')).length}/6 reached 'occupied')` });
  const stay = gk.filter((k) => (k.params as { actor: string }).actor !== 'g1');
  const stayOk = stay.map((k) => ({ a: (k.params as { actor: string }).actor, st: k.status, act: act(rt, (k.params as { actor: string }).actor), on: onSlot(rt, (k.params as { actor: string }).actor, heldBy(k.id)) }));
  out.push({
    ok: g?.status === 'executing' && stayOk.length === 5 && stayOk.every((x) => x.st === 'executing' && x.act === 'warm' && x.on.ok),
    message: `${pend('pull')}circle kept its other 5 after the pull-away, each warm on its claimed place facing the fire (${stayOk.map((x) => `${x.a}: ${x.act}, ${x.on.why}`).join('; ')})`,
  });
  const conv = rec(s, 'converse')?.recs[0];
  const f1 = angleDelta(yawOf(rt, 'c1'), heading([p2(rt, 'c2')[0] - p2(rt, 'c1')[0], p2(rt, 'c2')[1] - p2(rt, 'c1')[1]]));
  const f2 = angleDelta(yawOf(rt, 'c2'), heading([p2(rt, 'c1')[0] - p2(rt, 'c2')[0], p2(rt, 'c1')[1] - p2(rt, 'c2')[1]]));
  out.push({ ok: conv?.status === 'executing' && conv.phase === 'talking' && Math.abs(f1) < 0.2 && Math.abs(f2) < 0.2, message: `converse: c1/c2 talking ${d2(p2(rt, 'c1'), p2(rt, 'c2')).toFixed(2)} m apart, facing each other (${fmtDeg(f1)}, ${fmtDeg(f2)} off)` });
  const sit2 = rec(s, 'sit-s2')?.recs[0];
  const seat2 = fixtureSlots(rt, rt.world.entities.chair2)[0];
  const on2 = onSlot(rt, 's2', seat2);
  out.push({ ok: sit2?.status === 'executing' && act(rt, 's2') === 'sit' && on2.ok, message: `s2 sits on chair2 facing the fire (${on2.why})` });
  const sit1 = rec(s, 'sit-s1')?.recs[0];
  const [stand, join] = rec(s, 'join')?.recs ?? [];
  const onJ = onSlot(rt, 's1', join && heldBy(join.id));
  out.push({
    ok: reached(sit1, 'occupied') && sit1?.status === 'cancelled' && stand?.status === 'completed' && join?.status === 'executing' && act(rt, 's1') === 'warm' && onJ.ok,
    message: `${pend('join')}s1 sat, stood at 40 s (stand ${stand?.status}) and joined the circle with take_slot (${join?.status}/${join?.phase}; ${onJ.why})`,
  });
  const x1 = rec(s, 'x1')?.recs[0];
  const full = ring.every((q) => q.claimedBy);
  out.push({ ok: reached(x1, 'occupied') && x1?.status === 'executing', message: `${pend('x1')}x1 took the last fire place (${x1?.status}/${x1?.phase})` });
  const [none, conflict] = rec(s, 'full')?.recs ?? [];
  out.push({
    ok: none?.diagnostic?.code === 'slot.none-free' && conflict?.diagnostic?.code === 'reservation.conflict',
    message: `${pend('full')}EXPECTED at 50 s: x2 sent to the full circle → ${none?.diagnostic?.code} + explicit place → ${conflict?.diagnostic?.code} (${conflict?.diagnostic?.message ?? ''})`,
  });
  const bench = rec(s, 'bench')?.recs[0];
  const onB = onSlot(rt, 'x2', bench && fixtureSlots(rt, rt.world.entities.bench1).find((q) => q.claimedBy === bench.id));
  out.push({ ok: bench?.status === 'executing' && act(rt, 'x2') === 'sit' && onB.ok, message: `${pend('bench')}x2 then sits on bench1 (blocked-then-completed; ${onB.why})` });
  const rel = rec(s, 'pull-release');
  const pull = rec(s, 'pull')?.recs[0];
  const g1k = gk.find((k) => (k.params as { actor: string }).actor === 'g1');
  out.push({
    ok: rel?.cancelled?.length === 1 && rel.cancelled[0] === g1k?.id && pull?.status === 'completed' && d2(p2(rt, 'g1'), PULL_TO) < 0.3,
    message: `${pend('pull')}pre-emption: releaseForDirective(g1) cancelled only ${rel?.cancelled?.join(', ')} (g1's take_slot ${g1k?.id}); directed walk_to ${pull?.status}`,
  });
  out.push({ ok: !full && ring.filter((q) => q.claimedBy).length === 7, message: `${pend('pull')}fire places claimed at the end: ${ring.filter((q) => q.claimedBy).length}/8 (g1's place freed)` });
  const amb = rec(s, 'ambient')?.recs[0];
  const walks = kids(amb).filter((k) => k.verb === 'walk_to');
  out.push({
    ok: amb?.status === 'executing' && walks.length >= 6 && walks.every((w) => pointInPolygon([(w.params as { x: number }).x, (w.params as { z: number }).z], WANDER)),
    message: `ambient_wander: ${walks.length} strolls, every target inside the lawn`,
  });
  const hs = Object.values(rt.world.entities).filter((e) => e.kind === 'human');
  let min = Infinity, pair = '';
  for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) {
    const d = d2(p2(rt, hs[i].id), p2(rt, hs[j].id));
    if (d < min) { min = d; pair = `${hs[i].id}/${hs[j].id}`; }
  }
  out.push({ ok: min >= 2 * HUMAN_RADIUS - 1e-6, message: `nobody overlaps (closest pair ${pair} ${min.toFixed(2)} m apart)` });
  out.push({ ok: rt.violations.length === 0, message: rt.violations.length ? `${rt.violations.length} violations, first: ${rt.violations[0].message}` : 'zero violations' });
  return out;
}

export const campfireEvening: Scenario = {
  name: 'campfire-evening',
  title: 'Campfire evening (HYPOTHETICAL, illustrative)',
  description:
    'HYPOTHETICAL / illustrative inhabited scene (milestone H, engine/social): 1 campfire, 2 benches, 3 camp chairs on open ground. 6 people gather round the fire, 2 converse a few metres away, 2 sit on chairs, 2 wander a lawn. At 40 s s1 stands and joins the circle; x1 takes the last place; at 50 s x2 finds the circle full (slot.none-free + reservation.conflict, expected) and sits on a bench; at 54 s the director pulls g1 away (releaseForDirective + walk_to) and the circle keeps its other places.',
  scene: () => provingGround(),
  humans: () => [],
  build: campfireRuntime,
  start: (rt) => fire(rt, scripts.get(rt)!),
  tick: (rt) => fire(rt, scripts.get(rt)!),
  done: (rt) => rt.tick >= END_S * 20,
  maxTicks: END_S * 20 + 20,
  focus: [-19.8, -22, 8.5, 180],
  evening: true,
  expectedFailure: (rt, id) => !!rec(scripts.get(rt)!, 'full')?.recs.some((r) => r.id === id),
  expect: campfireChecks,
};
