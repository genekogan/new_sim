// Prone receiver (owner feedback §13, Gene 2026-09-29): where kneeling at the edge cannot reach the load (the 0.5 m
// kneel rule), a receiver lies on their stomach at the deck edge, reaches down ≤ 0.73 m below the deck (the measured
// rig, W32), takes it and gets up without letting go — push-up on one hand (the other holds the load), kneel, stand —
// while the load comes straight up outside the edge, clear of the deck edge, the joist ends, beams and any wall. The
// lying body turns toward the grip (`human.proneYaw`) and its chest, head and arms past the lip clear everything there.
// Refused with a diagnostic when it cannot (`handup.too-high` listing stand / kneel / prone reach, `handup.rise-blocked`
// naming the member).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { component } from '../world/factory.ts';
import { def } from '../world/catalog.ts';
import { levelFor, sweepPoses } from '../construction/access.ts';
import { ENVELOPE_TOL, envelopeGap, handsOf, handupHands, PRONE_ACTIVITY, proneBodyHit, proneDeckHand, REACH_DOWN, REACH_DOWN_PRONE } from '../construction/handup.ts';
import { BODY_MODEL, proneAt, proneFrame, proneReachGap, restHands } from '../body/model.ts';
import { dcos, dsin, angleDelta } from '../core/math.ts';
import { hashOf } from '../core/hash.ts';
import { bay, BEAM_H, JOIST_H } from './frame-fixtures.ts';
import { HAND_STEP_MAX } from './hands-check.ts';
import { Runtime } from '../runtime/runtime.ts';
import { human } from '../world/factory.ts';
import { forklift, FORKLIFT_ACTIONS, FORKLIFT_INVARIANTS } from '../vehicles/forklift.ts';
import { VEHICLE_ACTIONS, VEHICLE_INVARIANTS } from '../vehicles/index.ts';
import { CARRY_INVARIANTS } from '../carry/invariants.ts';
import { run } from './frame-fixtures.ts';
import type { Vec2, Vec3 } from '../core/math.ts';
import type { Entity } from '../world/types.ts';

const L = def('beam-12ft').size[0];
const PT = def('plywood-4x3').size;
const P = BODY_MODEL.prone;
/** The tallest deck (beam seats every 6 in) whose hand-off from the ground (givers ≤ 2.05 m + the sheet) is within the
 *  prone reach 0.73 m: 2.750 m (0.68 m below it); the next seat up is 2.902 m (0.83 m: too high). */
const DECK = 2.75, DECK_UP = 2.9;
const OUT: Vec2 = [1, 0]; // the east deck edge (over b3) faces +x

/**
 * A 12 ft bay whose upper floor is at `deck` m: 4x3 sheets d0 (south end) and d2 (north end) installed on joists, the
 * middle open (joists only) where sheet s1 goes; s1 on the ground east of the bay; p3 / p4 on the deck (south / north),
 * p1 / p2 on the ground. The decks' joists (j1, j2, j7, j8) are 4 ft, ending flush with the deck lip; the open middle's
 * (j3–j6) 6 ft, overhanging b3 by 0.30 m — the load comes up outside their ends. `tails: true` makes every joist 6 ft
 * (W29's fixture: joist tails 0.30 m past the lip under the decks too). `decks: false` leaves the floor out (receivers
 * can only kneel on the beams). `people`: extra humans standing on the deck.
 */
function proneBay(deck: number, o: { decks?: boolean; extra?: Entity[]; fork?: boolean; tails?: boolean; people?: [string, number, number][] } = {}) {
  const seat = deck - PT[1] - JOIST_H - BEAM_H / 2;
  const jz = [0.25, 0.7, L / 2 - 0.75, L / 2 - 0.25, L / 2 + 0.25, L / 2 + 0.75, L - 0.7, L - 0.25];
  const b = bay(
    { seat, beam: 'beam-12ft', joists: jz, ...(o.fork ? { actions: [...VEHICLE_ACTIONS, ...FORKLIFT_ACTIONS], invariants: [...CARRY_INVARIANTS, ...VEHICLE_INVARIANTS, ...FORKLIFT_INVARIANTS] } : {}) },
    [component('s1', 'plywood-4x6', [o.fork ? 5.6 : 2.6, 0, L / 2], Math.PI / 2, { phase: 'staged' }), ...(o.fork ? [forklift('f1', 10, L / 2, Math.PI), human('op', 10, L / 2 + 0.95)] : []), ...(o.people ?? []).map(([id]) => human(id, 0, -8))],
  );
  const w = b.rt.world;
  const jt = b.top + JOIST_H;
  const deckY = jt + PT[1];
  if (o.decks !== false) {
    if (!o.tails) for (const j of ['j1', 'j2', 'j7', 'j8']) w.entities[j].def = '2x4-4ft';
    for (const [id, z, under] of [['d0', PT[0] / 2, ['j1', 'j2']], ['d2', L - PT[0] / 2, ['j7', 'j8']]] as const) {
      const s = component(id, 'plywood-4x3', [0, jt, z], Math.PI / 2, { phase: 'installed' });
      s.support = { kind: 'resting-on', on: under[0] };
      s.connections = under.map((x) => ({ socket: 'bears-on', to: x, toSocket: 'sheet' }));
      w.entities[id] = s;
    }
    const put = (id: string, x: number, z: number) => { const h = w.entities[id]; h.pose = { p: [x, deckY, z], yaw: 0 }; h.human!.level = levelFor(deckY); };
    put('p3', -0.3, 0.45);
    put('p4', -0.3, L - 0.45);
    for (const [id, x, z] of o.people ?? []) put(id, x, z);
  }
  for (const e of o.extra ?? []) w.entities[e.id] = e;
  const rt = new Runtime(w, b.rt.registry, b.rt.services, b.rt.invariants);
  return { ...b, rt, E: rt.world.entities, deckY, to: { x: 0, z: L / 2, yaw: Math.PI / 2 } };
}
const d3 = (a: Vec3, b: Vec3) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
const heading = (yaw: number): Vec2 => [dcos(yaw), dsin(yaw)];
const PRONE_ACTS = new Set<string>(Object.values(PRONE_ACTIVITY));

/** Run a hand-up to the end, checking every tick: hand points continuous, prone hands in their envelopes, one hand
 *  on the load through the rise, the load clear of everything while taken and rising; the lying heading published and
 *  ≤ turnMax off the edge normal, `phaseK` 0–1 from lie-down to the release; at the take both hands within reach of
 *  the shoulders at that heading and the chest / head / arms past the lip clear of everything. */
function watchProne(rt: Runtime, id: string, E: Record<string, Entity>, receivers: string[], deckY: number, ignore: string[] = []) {
  const r = rt.records.get(id)!;
  const prev = new Map<string, [Vec3, Vec3]>();
  const acts = new Map<string, string[]>();
  const turn = new Map<string, number>();
  let ticks = 0, worstStep = 0, handoff = -Infinity, riseTicks = 0, sweptTicks = 0, takeTicks = 0, phaseTicks = 0;
  const pushed = new Set<string>();
  while (r.status !== 'completed' && r.status !== 'failed' && ticks < 20 * 400) {
    rt.step();
    ticks++;
    for (const h of Object.values(E)) {
      if (!h.human) continue;
      const hs = handsOf(h);
      if (hs) {
        const from = prev.get(h.id) ?? restHands(h);
        const d = Math.max(d3(hs[0], from[0]), d3(hs[1], from[1]));
        worstStep = Math.max(worstStep, d);
        assert.ok(d <= HAND_STEP_MAX + 1e-9, `hands.teleport: ${h.id} (${h.human.activity}) hands jumped ${d.toFixed(3)} m at tick ${rt.tick}`);
        prev.set(h.id, hs);
      } else prev.delete(h.id);
      if (!receivers.includes(h.id)) assert.equal(h.human.phaseK, undefined, `${h.id} publishes phaseK (prone receivers only)`);
    }
    const s1 = E.s1;
    for (const q of receivers) {
      const h = E[q], a = h.human!.activity, l = acts.get(q) ?? [];
      if (l[l.length - 1] !== a) l.push(a);
      acts.set(q, l);
      const k = h.human!.phaseK, py = h.human!.proneYaw;
      if (h.human!.task === id) {
        assert.ok(k !== undefined && k >= 0 && k <= 1, `${q} (${a}) phaseK ${k} at tick ${rt.tick}`);
        phaseTicks++;
      }
      if (PRONE_ACTS.has(a)) {
        assert.ok(py !== undefined, `${q} (${a}) publishes proneYaw`);
        const t = angleDelta(h.pose.yaw, py!);
        assert.ok(Math.abs(t) <= (P.turnMax * Math.PI) / 180 + 1e-9, `${q} lies ${t.toFixed(3)} rad off the edge normal`);
        assert.ok(Math.abs(angleDelta(h.pose.yaw, 0)) < 1e-9, `${q} pose.yaw keeps facing out over the edge (+x)`);
        if (a !== PRONE_ACTIVITY.lieDown) turn.set(q, t);
      } else assert.equal(py, undefined, `${q} (${a}) proneYaw only while lying / getting up`);
      const slot = h.human!.grip?.slot;
      if (!slot) continue;
      assert.match(slot, /^handup-prone-\d:(left|right)$/);
      const hs = handsOf(h)!;
      for (const p of hs) {
        const g = envelopeGap(a, h.pose.p, p);
        assert.ok(g <= ENVELOPE_TOL, `${q} (${a}) hand ${g.toFixed(3)} m outside the envelope at tick ${rt.tick}`);
        assert.ok(deckY - p[1] <= REACH_DOWN_PRONE + 1e-9, `${q} hand ${(deckY - p[1]).toFixed(3)} m below the deck`);
      }
      const grip = handupHands(s1, s1.pose, h, slot)!;
      const hold = slot.endsWith('left') ? 0 : 1;
      if (a === 'push-up' || a === 'kneel-up') {
        riseTicks++;
        assert.deepEqual(hs[hold], grip[hold], `${q} let go of the load while getting up (${a}, tick ${rt.tick})`);
        for (const p of hs) assert.ok(p[1] <= deckY + BODY_MODEL.armLength, 'a hand on the load or the deck');
      } else if (a === PRONE_ACTIVITY.reach) {
        // deepest the hands go while reaching / taking = at the grip
        handoff = Math.max(handoff, deckY - Math.min(hs[0][1], hs[1][1]));
        if (d3(hs[0], grip[0]) < 1e-9 && d3(hs[1], grip[1]) < 1e-9) {
          // the take, exactly: each hand within reach of its shoulder lying along proneYaw, the body past the lip clear
          takeTicks++;
          const fr = proneFrame(h.pose.p, OUT, heading(py!));
          const tip = Math.max(...hs.map((p, j) => { const g = proneReachGap(fr, p, j ? 'right' : 'left'); assert.ok(g.gap <= 1e-9, `${q} ${j ? 'right' : 'left'} hand ${g.gap.toFixed(3)} m beyond the shoulder's reach at tick ${rt.tick}`); return g.tip; }));
          const bh = proneBodyHit(rt, fr, tip, hs, s1.id);
          assert.equal(bh, null, `${q}'s ${bh?.part} passes through ${bh?.id} at tick ${rt.tick}`);
        }
      }
      // pushing off the deck: the free hand flat on it beside the chest (along the lying heading)
      if (a === 'push-up' && py !== undefined && d3(hs[1 - hold], proneDeckHand(h.pose.p, heading(py), 1 - hold)) < 1e-9) pushed.add(q);
    }
    // the load clear of everything (deck edge, joists, beams, walls) every tick it is taken or rising
    const ra = E[receivers[0]].human!.activity;
    if (ra === PRONE_ACTIVITY.reach || ra === 'push-up' || ra === 'kneel-up') {
      sweptTicks++;
      const hit = sweepPoses(rt, s1, [s1.pose, s1.pose], s1.support?.kind === 'forks' ? ignore : []);
      assert.equal(hit, null, `${s1.id} overlaps ${hit?.o.id} at tick ${rt.tick} (${ra})`);
    }
  }
  assert.deepEqual([...pushed].sort(), [...receivers].sort(), 'every prone receiver pushes off the deck with the free hand');
  for (const q of receivers) assert.ok(E[q].human!.phaseK === undefined && E[q].human!.proneYaw === undefined, `${q}: phaseK / proneYaw cleared at the release`);
  return { r, ticks, worstStep, handoff, riseTicks, sweptTicks, takeTicks, phaseTicks, acts, turn };
}

test(`prone receivers at the tallest deck the rig reaches from (${DECK} m): kneeling cannot reach (0.5 m), two people lying at the deck edge, turned toward the grips, take it ≈ 0.67 m below the deck and get up holding it; 0 violations, hands continuous`, () => {
  const { rt, E, to, deckY } = proneBay(DECK);
  assert.ok(Math.abs(deckY - 2.75) < 0.01, `deck at ${deckY}`);
  const r = rt.submit('hand_up', { part: 's1', givers: ['p1', 'p2'], receivers: ['p3', 'p4'], to });
  assert.notEqual(r.status, 'failed', `${r.diagnostic?.code} ${r.diagnostic?.message}`);
  const w = watchProne(rt, r.id, E, ['p3', 'p4'], deckY);
  assert.equal(w.r.status, 'completed', `${w.r.diagnostic?.code} ${w.r.diagnostic?.message}`);
  assert.deepEqual(rt.violations, [], JSON.stringify(rt.violations.slice(0, 3)));
  for (const q of ['p3', 'p4'])
    assert.deepEqual(w.acts.get(q)!.filter((a) => a !== 'idle' && a !== 'walk'), ['lie-down', 'prone-wait', 'prone-reach', 'push-up', 'kneel-up', 'stand_with_load', 'lay', 'set_down'], `${q}: ${w.acts.get(q)}`);
  // the hand-off: below the kneel rule, within the prone reach (the rig's 0.73 m)
  assert.ok(w.handoff > REACH_DOWN && w.handoff <= REACH_DOWN_PRONE, `hand-off ${w.handoff.toFixed(3)} m below the deck`);
  assert.ok(Math.abs(w.handoff - 0.673) < 0.01, `hand-off ≈ 0.67 m below the deck (${w.handoff.toFixed(3)})`);
  // they lie turned toward the sheet's ends (p3 on d0 south of it: +, p4 on d2 north: −), ≤ 45°
  assert.ok(w.turn.get('p3')! > 0.1 && w.turn.get('p4')! < -0.1, `turns ${w.turn.get('p3')?.toFixed(3)} / ${w.turn.get('p4')?.toFixed(3)}`);
  assert.ok(w.worstStep <= HAND_STEP_MAX && w.riseTicks >= 2 * 20 && w.sweptTicks >= 20 && w.takeTicks >= 2 * 8, `worst step ${w.worstStep.toFixed(3)}, rise ${w.riseTicks}, swept ${w.sweptTicks}, take ${w.takeTicks}`);
  assert.ok(w.phaseTicks >= 2 * 60, `phaseK ticks ${w.phaseTicks}`);
  assert.equal(E.s1.phase, 'staged');
  assert.equal(E.s1.support?.kind, 'resting-on');
  assert.ok(Math.abs(E.s1.pose.p[2] - to.z) < 1e-9 && Math.abs(E.s1.pose.p[0] - to.x) < 1e-9);
  const out = w.r.outputs as { stations: unknown[][] };
  assert.deepEqual(out.stations.map((s) => s[s.length - 1]), ['prone', 'prone']);
  for (const q of ['p3', 'p4']) assert.equal(E[q].human!.hands, undefined, 'hands cleared when they let go');
});

test('one prone receiver takes a 4x6 sheet alone (carry crew 1–2); determinism: the same run twice is bit-identical', () => {
  const once = () => {
    const { rt, E, to, deckY } = proneBay(DECK);
    const r = rt.submit('hand_up', { part: 's1', givers: ['p1', 'p2'], receivers: ['p3'], to });
    assert.notEqual(r.status, 'failed', `${r.diagnostic?.code} ${r.diagnostic?.message}`);
    const w = watchProne(rt, r.id, E, ['p3'], deckY);
    assert.equal(w.r.status, 'completed', `${w.r.diagnostic?.code} ${w.r.diagnostic?.message}`);
    assert.deepEqual(rt.violations, []);
    return { hash: hashOf(rt.world), ticks: w.ticks };
  };
  const a = once(), b = once();
  assert.deepEqual(a, b);
});

test('the lying body is checked at its heading (toes 0.75 m behind S, half-width 0.20 m) against people and parts on the deck: where the only place a receiver can lie is taken, refused naming who / what is there', () => {
  // p3 alone lies on d0 at S (0.26, 0.60) turned 20° (the one-receiver run): its legs pass (-0.15, 0.45), 0.44 m from S
  const person = proneBay(DECK, { people: [['p5', -0.15, 0.45]] });
  const a = person.rt.submit('hand_up', { part: 's1', givers: ['p1', 'p2'], receivers: ['p3'], to: person.to });
  assert.equal(a.diagnostic?.code, 'handup.no-receiver-station', `${a.diagnostic?.code} ${a.diagnostic?.message}`);
  assert.match(a.diagnostic!.message, /no room to lie down from \(0\.26, 0\.\d+\) turned \d+°: p5 is there/);
  // a stair tread left on the deck behind S, under where the turned body's legs would lie
  const tread = component('c1', 'stair-tread', [-0.2, person.deckY, 0.3], 0.35, { phase: 'installed' });
  const part = proneBay(DECK, { extra: [tread] });
  const b = part.rt.submit('hand_up', { part: 's1', givers: ['p1', 'p2'], receivers: ['p3'], to: part.to });
  assert.equal(b.diagnostic?.code, 'handup.no-receiver-station', `${b.diagnostic?.code} ${b.diagnostic?.message}`);
  assert.match(b.diagnostic!.message, /no room to lie down from \(0\.26, 0\.\d+\) turned \d+°: stair tread .*\(c1\) is in the way/);
});

test('prone only where kneeling cannot reach: the same floor with no deck to lie on is refused handup.too-high, listing the three reaches', () => {
  const { rt, to } = proneBay(DECK, { decks: false });
  const r = rt.submit('hand_up', { part: 's1', givers: ['p1', 'p2'], receivers: ['p3', 'p4'], to });
  assert.equal(r.diagnostic?.code, 'handup.too-high', `${r.diagnostic?.code} ${r.diagnostic?.message}`);
  assert.match(r.diagnostic!.message, /reach down standing to 0\.60 m above their feet, kneeling ≤ 0\.5 m below them, lying prone ≤ 0\.73 m below a deck, but no deck covers b3 to lie on\); use the forklift/);
});

test('the next seat up (a 2.90 m deck: 0.83 m below it) is out of reach even lying prone: handup.too-high lists stand / kneel / prone reach', () => {
  const { rt, to, deckY } = proneBay(DECK_UP);
  assert.ok(Math.abs(deckY - 2.902) < 0.01, `deck at ${deckY}`);
  const r = rt.submit('hand_up', { part: 's1', givers: ['p1', 'p2'], receivers: ['p3', 'p4'], to });
  assert.equal(r.status, 'failed');
  assert.equal(r.diagnostic?.code, 'handup.too-high');
  assert.match(r.diagnostic!.message, /receivers reach down standing to 0\.60 m above their feet, kneeling ≤ 0\.5 m below them, lying prone at the edge of the deck at 2\.90 m ≤ 0\.73 m below it, here 0\.83 m\); use the forklift/);
});

test('the rise is swept: a wall panel outside the deck edge in the way of the load coming up is refused handup.rise-blocked, naming it', () => {
  // a 4 ft wall panel stood up (roll π/2) outside b3, 0.19 m beyond the joist ends, its bottom at 2.3 m: above the
  // givers' reach (the load comes up to 2.05 m), in the way of the rise to slide height (2.78 m)
  const panel = component('w1', 'plywood-4x2200mm', [1.1, 2.3 + 1.1, L / 2], 0, { phase: 'installed', pose: { p: [1.1, 2.3 + 1.1, L / 2], yaw: 0, roll: Math.PI / 2 } });
  const { rt, to } = proneBay(DECK, { extra: [panel] });
  const r = rt.submit('hand_up', { part: 's1', givers: ['p1', 'p2'], receivers: ['p3', 'p4'], to });
  assert.equal(r.status, 'failed');
  assert.equal(r.diagnostic?.code, 'handup.rise-blocked', `${r.diagnostic?.code} ${r.diagnostic?.message}`);
  assert.ok(r.diagnostic!.subjects!.includes('w1'), JSON.stringify(r.diagnostic));
  assert.match(r.diagnostic!.message, /s1 cannot rise past the deck edge over b3 in the hands of a receiver lying there: .*\(w1\) is in the way of its rise/);
  // without the panel the same hand-up plans
  const ok = proneBay(DECK).rt.submit('hand_up', { part: 's1', givers: ['p1', 'p2'], receivers: ['p3', 'p4'], to });
  assert.notEqual(ok.status, 'failed');
});

test('beyond the lip the lying body is swept (W29): joist tails 0.30 m past the lip under both decks put a chest / head / arm through a joist wherever they could lie — handup.rise-blocked naming it', () => {
  const { rt, to } = proneBay(DECK, { tails: true });
  const r = rt.submit('hand_up', { part: 's1', givers: ['p1', 'p2'], receivers: ['p3', 'p4'], to });
  assert.equal(r.status, 'failed');
  assert.equal(r.diagnostic?.code, 'handup.rise-blocked', `${r.diagnostic?.code} ${r.diagnostic?.message}`);
  assert.match(r.diagnostic!.message, /s1 cannot be taken over the deck edge over b3 by receivers lying there: lying at \([\d.]+, [\d.]+\)( turned \d+°)? with the chest tipped \d+° over the lip, their (chest|head|left arm|right arm) would pass through 6 ft 2x4 \((j\d)\)/);
  const j = /\((j\d)\)/.exec(r.diagnostic!.message)![1];
  assert.ok(r.diagnostic!.subjects!.includes(j) && ['j1', 'j2', 'j3', 'j6', 'j7', 'j8'].includes(j), JSON.stringify(r.diagnostic));
});

test('prone receivers take a sheet off the forks where kneeling cannot reach: at the limit at that presentation (0.70 m below the deck) green, 0 violations; deeper refused (0.72 m: no station reaches, 0.74 m: too-high "raise the forks")', () => {
  const present = (depth: number) => {
    const b = proneBay(DECK_UP, { fork: true });
    run(b.rt, 'mount', { actor: 'op', vehicle: 'f1' }, 400);
    run(b.rt, 'forklift_pick', { operator: 'op', item: 's1' });
    // outside the middle joists' ends (2x4-6ft: ±0.91 m) by 6 cm; `depth` m below the deck = the hands
    const W = def('plywood-4x6').size[2];
    const at = { x: def('2x4-6ft').size[0] / 2 + 0.06 + W / 2, z: L / 2, y: b.deckY - depth - def('plywood-4x6').size[1], yaw: Math.PI / 2 };
    run(b.rt, 'forklift_present', { operator: 'op', at });
    assert.equal(b.E.s1.support?.kind, 'forks');
    return { ...b, r: b.rt.submit('hand_up', { part: 's1', via: 'forklift', operator: 'op', receivers: ['p3', 'p4'], to: b.to }) };
  };
  const g = present(0.7);
  assert.notEqual(g.r.status, 'failed', `${g.r.diagnostic?.code} ${g.r.diagnostic?.message}`);
  const w = watchProne(g.rt, g.r.id, g.E, ['p3', 'p4'], g.deckY, ['f1']);
  assert.equal(w.r.status, 'completed', `${w.r.diagnostic?.code} ${w.r.diagnostic?.message}`);
  assert.deepEqual(g.rt.violations, [], JSON.stringify(g.rt.violations.slice(0, 3)));
  assert.ok(Math.abs(w.handoff - 0.7) < 0.01, `hand-off ${w.handoff.toFixed(3)} m below the deck`);
  assert.equal(g.E.s1.phase, 'staged');
  // 2 cm deeper: within the 0.73 m cap, but from nowhere at the edge do the shoulders reach it (6 cm beyond the joist ends)
  const d = present(0.72).r;
  assert.equal(d.diagnostic?.code, 'handup.no-receiver-station', `${d.diagnostic?.code} ${d.diagnostic?.message}`);
  assert.match(d.diagnostic!.message, /beyond reach of the load \(arm 0\.62 m \+ girdle 0\.1 m from the shoulder/);
  // just past the cap: refused, listing the three reaches
  const low = present(0.74).r;
  assert.equal(low.diagnostic?.code, 'handup.too-high');
  assert.match(low.diagnostic!.message, /lying prone at the edge of the deck at 2\.90 m ≤ 0\.73 m below it, here 0\.74 m\); raise the forks/);
});
