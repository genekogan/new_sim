// Engine Lab presets `prone` / `prone-forks` (owner feedback §13, HANDUP.md "Prone receiver", POSES.md "Prone
// receiver"): the engine test fixture of engine/test/handup-prone.test.ts as a runnable scene — a 12 ft bay whose
// upper floor is at 2.9 m, 4x3 sheets d0 / d2 installed at its south / north ends, the middle open where the 4x6
// sheet s1 goes. Kneeling at the edge cannot reach 0.83 m below the deck (the 0.5 m kneel rule), so p3 / p4 walk to
// the east deck edge, lie down on their stomachs over it, take s1 from the givers p1 / p2 below (or off the forks),
// push up on one hand, kneel up and stand holding it, then lay it. Pure TS (no three.js / DOM).
import { component, human } from '../../engine/world/factory.ts';
import { def } from '../../engine/world/catalog.ts';
import { levelFor } from '../../engine/construction/access.ts';
import { Runtime } from '../../engine/runtime/runtime.ts';
import { forklift, FORKLIFT_ACTIONS, FORKLIFT_INVARIANTS } from '../../engine/vehicles/forklift.ts';
import { VEHICLE_ACTIONS, VEHICLE_INVARIANTS } from '../../engine/vehicles/index.ts';
import { CARRY_INVARIANTS } from '../../engine/carry/invariants.ts';
import { bay, BEAM_H, JOIST_H, openGround } from '../../engine/test/frame-fixtures.ts';
import type { Scenario } from './scenarios.ts';

const L = def('beam-12ft').size[0];
const PT = def('plywood-4x3').size;
/** Deck top (m) of the fixture: the beam seat nearest 2.9 m gives 2.90. */
export const PRONE_DECK = 2.9;
/** The hand-up's target pose (engine test `to`). */
const TO = { x: 0, z: L / 2, yaw: Math.PI / 2 };

/** engine/test/handup-prone.test.ts `proneBay(2.9, { fork })`, entity for entity. */
function proneBay(fork: boolean) {
  const deck = PRONE_DECK;
  const seat = deck - PT[1] - JOIST_H - BEAM_H / 2;
  const jz = [0.25, 0.7, L / 2 - 0.75, L / 2 - 0.25, L / 2 + 0.25, L / 2 + 0.75, L - 0.7, L - 0.25];
  const b = bay(
    { seat, beam: 'beam-12ft', joists: jz, ...(fork ? { actions: [...VEHICLE_ACTIONS, ...FORKLIFT_ACTIONS], invariants: [...CARRY_INVARIANTS, ...VEHICLE_INVARIANTS, ...FORKLIFT_INVARIANTS] } : {}) },
    [component('s1', 'plywood-4x6', [fork ? 5.6 : 2.6, 0, L / 2], Math.PI / 2, { phase: 'staged' }), ...(fork ? [forklift('f1', 10, L / 2, Math.PI), human('op', 10, L / 2 + 0.95)] : [])],
  );
  const w = b.rt.world;
  const jt = b.top + JOIST_H;
  const deckY = jt + PT[1];
  for (const [id, z, under] of [['d0', PT[0] / 2, ['j1', 'j2']], ['d2', L - PT[0] / 2, ['j7', 'j8']]] as const) {
    const s = component(id, 'plywood-4x3', [0, jt, z], Math.PI / 2, { phase: 'installed' });
    s.support = { kind: 'resting-on', on: under[0] };
    s.connections = under.map((x) => ({ socket: 'bears-on', to: x, toSocket: 'sheet' }));
    w.entities[id] = s;
  }
  const put = (id: string, x: number, z: number) => {
    const h = w.entities[id];
    h.pose = { p: [x, deckY, z], yaw: 0 };
    h.human!.level = levelFor(deckY);
  };
  put('p3', -0.3, 0.45);
  put('p4', -0.3, L - 0.45);
  return new Runtime(w, b.rt.registry, b.rt.services, b.rt.invariants);
}

/** Forklift script (engine test): mount, pick s1, present it outside the joist ends 0.75 m below the deck, hand it up. */
function forkSteps(): [string, Record<string, unknown>][] {
  const W = def('plywood-4x6').size[2];
  const at = { x: def('2x4-6ft').size[0] / 2 + 0.06 + W / 2, z: L / 2, y: PRONE_DECK - 0.75 - def('plywood-4x6').size[1], yaw: Math.PI / 2 };
  return [
    ['mount', { actor: 'op', vehicle: 'f1' }],
    ['forklift_pick', { operator: 'op', item: 's1' }],
    ['forklift_present', { operator: 'op', at }],
    ['hand_up', { part: 's1', via: 'forklift', operator: 'op', receivers: ['p3', 'p4'], to: TO }],
  ];
}
const HAND_STEPS: [string, Record<string, unknown>][] = [['hand_up', { part: 's1', givers: ['p1', 'p2'], receivers: ['p3', 'p4'], to: TO }]];

/** One step at a time: submit the next once the last completed (a failed step stops the script). */
const scripts = new WeakMap<Runtime, { steps: [string, Record<string, unknown>][]; ids: string[] }>();
function advance(rt: Runtime) {
  const s = scripts.get(rt)!;
  const last = s.ids[s.ids.length - 1];
  if (last && rt.records.get(last)?.status !== 'completed') return;
  const next = s.steps[s.ids.length];
  if (next) s.ids.push(rt.submit(next[0], next[1]).id);
}
const finished = (rt: Runtime) => {
  const s = scripts.get(rt);
  if (!s || s.ids.length < s.steps.length) return false;
  return [...rt.records.values()].every((r) => r.status === 'completed' || r.status === 'failed');
};

function preset(fork: boolean): Scenario {
  const steps = fork ? forkSteps() : HAND_STEPS;
  return {
    name: fork ? 'prone-forks' : 'prone',
    title: fork ? 'Prone hand-up off the forks (2.9 m deck)' : 'Prone hand-up (2.9 m deck)',
    description: fork
      ? 'HYPOTHETICAL (engine/test/handup-prone.test.ts): the forklift presents 4x6 sheet s1 outside the joist ends 0.75 m below a 2.9 m deck; p3 and p4 lie on their stomachs at the deck edge, take it off the forks, push up on one hand, kneel up and stand holding it, then lay it (owner feedback §13).'
      : 'HYPOTHETICAL (engine/test/handup-prone.test.ts): givers p1 / p2 raise 4x6 sheet s1 overhead beside a 2.9 m deck — 0.83 m below its top, deeper than kneeling reaches — and p3 / p4, lying on their stomachs at the deck edge, reach down, take it, push up on one hand, kneel up and stand holding it, then lay it (owner feedback §13).',
    scene: openGround,
    humans: () => [],
    build: () => {
      const rt = proneBay(fork);
      scripts.set(rt, { steps, ids: [] });
      return rt;
    },
    start: advance,
    tick: advance,
    done: finished,
    maxTicks: 20 * 120,
    focus: [0.6, L / 2, 6, 20],
    expect: (rt) => {
      const bad = [...rt.records.values()].filter((r) => r.status !== 'completed');
      const s1 = rt.world.entities.s1;
      return [
        { ok: bad.length === 0, message: bad.length ? `not completed: ${bad.map((r) => `${r.id} ${r.verb} ${r.status} ${r.diagnostic?.message ?? ''}`).join('; ')}` : `all ${rt.records.size} actions completed` },
        { ok: rt.violations.length === 0, message: rt.violations.length ? `${rt.violations.length} violations, first: ${rt.violations[0].message}` : 'zero violations' },
        { ok: s1?.phase === 'staged' && s1.support?.kind === 'resting-on', message: `s1 staged on the joists (${s1?.phase}, ${s1?.support?.kind})` },
      ];
    },
  };
}

export const prone = preset(false);
export const proneForks = preset(true);
