// D1 (playtest 2026-10-25): the world reports the body, not the plan. bodyState / cardDoing read engine state on every
// call; these cases drive them with a small stand-in engine (the reading itself is engine-independent).
import test from 'node:test';
import assert from 'node:assert/strict';
import {bodyState, bodyWords, cardDoing} from './body-state.ts';

type Human = {activity: string; level?: number; carrier?: {id: string; slot: string; phase: string}; shore?: {submergedHeightMetres: number}; sleepPose?: unknown; baseActivity?: string; riding?: string};
function fake() {
  const entities: Record<string, {id: string; label?: string; pose: {p: number[]; yaw: number}; human?: Human; carrier?: {phase: string}}> = {
    s1: {id: 's1', pose: {p: [0, 0, 0], yaw: 0}, human: {activity: 'idle', level: 0}},
    wheel: {id: 'wheel', label: 'ferris wheel', pose: {p: [0, 0, 5], yaw: 0}, carrier: {phase: 'boarding'}},
    punt: {id: 'punt', label: 'punt', pose: {p: [0, 0, 5], yaw: 0}, carrier: {phase: 'boarding'}},
  };
  const st = {program: null as string | null, depth: 0};
  const engine = {
    world: {tick: 0, entities},
    programOf: () => st.program,
    bodyWaterDepthV1: () => st.depth,
    carrierOf: (a: string) => {const b = entities[a]?.human?.carrier, e = b ? entities[b.id] : undefined; return b && e?.carrier ? {id: e.id, slot: b.slot, riderPhase: b.phase, phase: e.carrier.phase, label: e.label ?? e.id} : null;},
  };
  const host = {engine, nameOf: (id: string) => entities[id]?.label ?? id} as never;
  const m = {soulId: 'soul-1', entityId: 's1', doing: 'standing around', pending: null} as never as {doing: string};
  return {host, m: m as never, mind: m, st, me: entities.s1, entities};
}

test('riding: the carrier names what the body does, from boarding to stepping out', () => {
  const f = fake(), h = f.me.human!;
  h.carrier = {id: 'wheel', slot: 'a', phase: 'boarding'}; f.st.program = 'p1'; f.mind.doing = 'Ride the ferris wheel';
  assert.equal(cardDoing(f.host, f.m), 'boarding the ferris wheel');
  h.carrier.phase = 'seated'; f.st.program = null; f.mind.doing = 'standing around';   // the join ended when seated
  assert.equal(cardDoing(f.host, f.m), 'seated in the ferris wheel, waiting for it to start');
  f.entities.wheel.carrier!.phase = 'aloft';
  const b = bodyState(f.host, 's1')!;
  assert.deepEqual({posture: b.posture, on: b.on, aboard: b.aboard, inWater: b.inWater}, {posture: 'riding', on: 'ferris wheel', aboard: 'seated', inWater: false});
  assert.equal(cardDoing(f.host, f.m), 'riding the ferris wheel');
  assert.equal(bodyWords(f.host, 's1', b), 'riding the ferris wheel');
  f.entities.wheel.carrier!.phase = 'landed'; h.carrier.phase = 'leaving';
  assert.equal(cardDoing(f.host, f.m), 'stepping out of the ferris wheel');
  delete h.carrier;
  assert.equal(cardDoing(f.host, f.m), 'standing around');
});

test('rowing: a seated rower in the punt reads rowing, a boarder reads boarding', () => {
  const f = fake(), h = f.me.human!;
  h.carrier = {id: 'punt', slot: 'a', phase: 'boarding'}; f.st.program = 'p1'; f.mind.doing = 'Row the punt loop and disembark';
  assert.equal(cardDoing(f.host, f.m), 'boarding the punt');
  h.carrier.phase = 'seated'; h.activity = 'row'; f.entities.punt.carrier!.phase = 'aloft';
  const b = bodyState(f.host, 's1')!;
  assert.equal(b.posture, 'rowing'); assert.equal(b.on, 'punt'); assert.equal(b.inWater, false, 'in the punt is not in the water');
  assert.equal(cardDoing(f.host, f.m), 'rowing the punt');
});

test('swimming and standing in water: water words after the program ends, never "standing around"', () => {
  const f = fake(), h = f.me.human!;
  h.activity = 'tread';
  assert.equal(bodyState(f.host, 's1')!.inWater, true); assert.equal(cardDoing(f.host, f.m), 'treading water');
  // 121122 zed-012/013: swim done, wave ran, the body stood waist-deep in the pond
  h.activity = 'idle'; f.st.depth = 0.9;
  const b = bodyState(f.host, 's1')!;
  assert.equal(b.inWater, true); assert.equal(b.posture, 'standing');
  assert.equal(cardDoing(f.host, f.m), 'standing in the water'); assert.equal(bodyWords(f.host, 's1', b), 'standing in the water');
  // the shore/1 controller's own immersion counts too; ankle-deep at the edge does not
  f.st.depth = 0; h.shore = {submergedHeightMetres: 1.1}; assert.equal(bodyState(f.host, 's1')!.inWater, true);
  h.shore = {submergedHeightMetres: 0.1}; assert.equal(bodyState(f.host, 's1')!.inWater, false);
  assert.equal(cardDoing(f.host, f.m), 'standing around');
});

test('approach walk: the step names where the body walks and how far, the card says walking until the pose', () => {
  const f = fake(), h = f.me.human!;
  f.st.program = 'p1'; f.mind.doing = 'Sit down'; h.activity = 'walk';
  const approach = {name: 'Kitchen chair', to: [18, 0] as [number, number]};
  const b = bodyState(f.host, 's1', approach)!;
  assert.equal(b.step, 'walking to Kitchen chair, 18 m left'); assert.equal(b.posture, 'walking');
  assert.equal(cardDoing(f.host, f.m, approach), 'walking to Kitchen chair');
  h.activity = 'sit';
  assert.equal(bodyState(f.host, 's1', approach)!.step, undefined, 'no step once in the pose');
  assert.equal(cardDoing(f.host, f.m, approach), 'Sit down');
  // a walk is its own main pose: the label stays
  h.activity = 'walk'; f.mind.doing = 'Walk to the pavilion';
  assert.equal(cardDoing(f.host, f.m, {name: 'Pavilion', to: [5, 0]}), 'Walk to the pavilion');
  // no program running: no step even while the activity reads walk
  f.st.program = null; assert.equal(bodyState(f.host, 's1', approach)!.step, undefined);
});

test('cancelled: with nothing running the card reads the body, not the stopped plan', () => {
  const f = fake();
  f.mind.doing = 'standing around'; f.me.human!.activity = 'idle';
  assert.equal(cardDoing(f.host, f.m), 'standing around');
  assert.equal(bodyWords(f.host, 's1', bodyState(f.host, 's1')!), 'standing');
});
