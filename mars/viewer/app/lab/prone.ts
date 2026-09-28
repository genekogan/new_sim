// Engine Lab presets `prone` / `prone-forks` (owner feedback §13, HANDUP.md "Prone receiver", POSES.md "Prone
// receiver"): the engine test fixture of engine/test/handup-prone.test.ts (W32) as a runnable scene — a 12 ft bay whose
// upper floor is at 2.750 m (the tallest 6 in beam seat whose hand-off from the ground is within the measured rig's
// prone reach, 0.73 m), 4x3 sheets d0 / d2 installed at its south / north ends on 4 ft joists ending at the deck lip,
// the open middle's 6 ft joists overhanging the east beam by 0.30 m, where the 4x6 sheet s1 goes. Kneeling at the edge
// cannot reach ≈ 0.67 m below the deck (the 0.5 m kneel rule), so p3 / p4 walk to the east deck edge, lie down on their
// stomachs turned toward the grips, take s1 from the givers p1 / p2 below, push up on one hand, kneel up and stand
// holding it, then lay it. `prone-forks`: the next seat up (2.902 m deck — too high by hand, 0.83 m), the forklift
// presenting s1 0.70 m below it, 6 cm outside the middle joists' ends. Pure TS (no three.js / DOM).
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
/** Deck top (m) by hand (engine test DECK: the seat gives 2.750) and off the forks (DECK_UP: 2.902). */
export const PRONE_DECK = 2.75, PRONE_DECK_UP = 2.9;
/** Off the forks: the sheet's underside this far below the deck top (engine test `present(0.7)`, the green limit). */
export const FORK_DEPTH = 0.7;
/** The hand-up's target pose (engine test `to`). */
const TO = { x: 0, z: L / 2, yaw: Math.PI / 2 };

/** engine/test/handup-prone.test.ts `proneBay(DECK)` / `proneBay(DECK_UP, { fork: true })`, entity for entity. */
function proneBay(fork: boolean) {
  const deck = fork ? PRONE_DECK_UP : PRONE_DECK;
  const seat = deck - PT[1] - JOIST_H - BEAM_H / 2;
  const jz = [0.25, 0.7, L / 2 - 0.75, L / 2 - 0.25, L / 2 + 0.25, L / 2 + 0.75, L - 0.7, L - 0.25];
  const b = bay(
    { seat, beam: 'beam-12ft', joists: jz, ...(fork ? { actions: [...VEHICLE_ACTIONS, ...FORKLIFT_ACTIONS], invariants: [...CARRY_INVARIANTS, ...VEHICLE_INVARIANTS, ...FORKLIFT_INVARIANTS] } : {}) },
    [component('s1', 'plywood-4x6', [fork ? 5.6 : 2.6, 0, L / 2], Math.PI / 2, { phase: 'staged' }), ...(fork ? [forklift('f1', 10, L / 2, Math.PI), human('op', 10, L / 2 + 0.95)] : [])],
  );
  const w = b.rt.world;
  const jt = b.top + JOIST_H;
  const deckY = jt + PT[1];
  // the decks' joists are 4 ft, ending flush with the deck lip (W29's all-6-ft tails are the engine's rise-blocked case)
  for (const j of ['j1', 'j2', 'j7', 'j8']) w.entities[j].def = '2x4-4ft';
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
  return { rt: new Runtime(w, b.rt.registry, b.rt.services, b.rt.invariants), deckY };
}

/** Forklift script (engine test): mount, pick s1, present it 6 cm outside the middle joists' ends with its underside
 *  FORK_DEPTH below the deck (the hands), hand it up. */
function forkSteps(deckY: number): [string, Record<string, unknown>][] {
  const W = def('plywood-4x6').size[2];
  const at = { x: def('2x4-6ft').size[0] / 2 + 0.06 + W / 2, z: L / 2, y: deckY - FORK_DEPTH - def('plywood-4x6').size[1], yaw: Math.PI / 2 };
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
  return {
    name: fork ? 'prone-forks' : 'prone',
    title: fork ? 'Prone hand-up off the forks (2.902 m deck, 0.70 m below)' : 'Prone hand-up (2.750 m deck)',
    description: fork
      ? 'HYPOTHETICAL (engine/test/handup-prone.test.ts, W32): a 2.902 m deck — too high by hand (0.83 m below its top; lying prone the rig reaches 0.73 m) — on 4 ft deck joists ending at the lip (6 ft in the open middle). The forklift presents 4x6 sheet s1 0.70 m below the deck, 6 cm outside the middle joists\' ends; p3 and p4 lie on their stomachs at the deck edge turned toward the grips, take it off the forks, push up on one hand, kneel up and stand holding it, then lay it (owner feedback §13).'
      : 'HYPOTHETICAL (engine/test/handup-prone.test.ts, W32): givers p1 / p2 raise 4x6 sheet s1 overhead beside a 2.750 m deck (4 ft deck joists ending at the lip, 6 ft in the open middle) — ≈ 0.67 m below its top: deeper than kneeling reaches (0.5 m), within the 0.73 m the rig reaches lying prone — and p3 / p4, lying on their stomachs at the deck edge turned toward the grips (±20°), reach down, take it, push up on one hand, kneel up and stand holding it, then lay it (owner feedback §13).',
    scene: openGround,
    humans: () => [],
    build: () => {
      const { rt, deckY } = proneBay(fork);
      scripts.set(rt, { steps: fork ? forkSteps(deckY) : HAND_STEPS, ids: [] });
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
