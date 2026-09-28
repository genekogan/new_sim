// Engine Lab scenarios: proving-ground regressions (engine/test/walk.test.ts)
// and the flagship build sequence (build-bay.ts) as runnable presets. Pure TS (no three.js/DOM) so node can run them too.
import { Runtime } from '../../engine/runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../../engine/runtime/invariants.ts';
import { Spatial } from '../../engine/spatial/service.ts';
import { provingGround, DECK_Y } from '../../engine/scenes/proving-ground.ts';
import { emptyWorld, human, addAll, component } from '../../engine/world/factory.ts';
import { walkTo } from '../../engine/locomotion/walk.ts';
import { clearanceAt } from '../../engine/spatial/grid.ts';
import { nextRandom, seedRng } from '../../engine/core/rng.ts';
import type { ActionDef } from '../../engine/actions/types.ts';
import type { Entity } from '../../engine/world/types.ts';
import type { SpatialScene } from '../../engine/spatial/types.ts';
import { body } from './body.ts';
import { buildBay } from './build-bay.ts';
import { campfireEvening } from './campfire-evening.ts';
import { handUp } from './hand-up.ts';
import { meal } from './meal.ts';
import { yearWalkabouts } from './year-walkabout.ts';
import { yearBuild, yearBuildHouse } from './year-build.ts';
import { solarPaint } from './solar-paint.ts';

export type Check = { ok: boolean; message: string };
export type Scenario = {
  name: string;
  title: string;
  description: string;
  scene: () => SpatialScene;
  humans: (base: SpatialScene) => Entity[];
  start: (rt: Runtime) => void;
  /** Called after every tick (scripted construction, stress re-targeting). */
  tick?: (rt: Runtime) => void;
  /** Never completes on its own (stress). */
  continuous?: boolean;
  /** Custom runtime (own registry/invariants/services), replacing the walk_to proving-ground default. */
  build?: () => Runtime;
  /** Custom completion test (e.g. a sequence), instead of "every action terminal". */
  done?: (rt: Runtime) => boolean;
  maxTicks: number;
  /** Camera focus (x, z), framing radius and optional oblique azimuth (deg, 0 = camera on +x, 90 = on +z). */
  focus: [number, number, number, number?];
  /** Tick ranges worth capturing mid-action (fractions of completion ticks). */
  capture?: number[];
  /** Dusk lighting; fixtures such as a campfire glow (campfire-evening). */
  evening?: boolean;
  /** Failed actions the script provokes on purpose (shown as amber EXPECTED diagnostics, not red failures). */
  expectedFailure?: (rt: Runtime, actionId: string) => boolean;
  expect: (rt: Runtime) => Check[];
  /** Async data the scenario needs before scene()/build() (fetched scene files); awaited by LabSim.loadAsync. */
  prepare?: () => Promise<void>;
  /** Extra status lines for the panel (e.g. year-walkabout build times). */
  hud?: (rt: Runtime) => string[];
};

export function buildRuntime(s: Scenario) {
  if (s.build) return s.build();
  const base = s.scene();
  const w = addAll(emptyWorld('proving-ground', base), ...s.humans(base));
  const rt = new Runtime(w, new Map<string, ActionDef>([['walk_to', walkTo]]), { spatial: new Spatial(base) }, DEFAULT_INVARIANTS);
  return rt;
}

const recs = (rt: Runtime) => [...rt.records.values()];
const allCompleted = (rt: Runtime): Check => {
  const bad = recs(rt).filter((r) => r.status !== 'completed');
  return { ok: bad.length === 0, message: bad.length ? `not completed: ${bad.map((r) => `${r.id} ${r.status} ${r.diagnostic?.message ?? ''}`).join('; ')}` : 'all actions completed' };
};
const noViolations = (rt: Runtime): Check => ({
  ok: rt.violations.length === 0,
  message: rt.violations.length ? `${rt.violations.length} violations, first: ${rt.violations[0].message}` : 'zero violations',
});
const onLevel = (rt: Runtime, id: string, level: number): Check => {
  const l = rt.world.entities[id].human!.level;
  return { ok: l === level, message: `${id} ends on level ${l} (expected ${level})` };
};
const usedPhase = (rt: Runtime, phase: string): Check => ({
  ok: recs(rt).some((r) => r.history.some((h) => h.phase === phase)),
  message: `phase "${phase}" occurred`,
});

export const PANEL_ID = 'panel';
/** An installed 4x8 plywood sheet standing on edge across the 1 m gap at (15, -15). */
export function dropPanel(rt: Runtime) {
  if (rt.world.entities[PANEL_ID]) return false;
  rt.world.entities[PANEL_ID] = component(PANEL_ID, 'plywood-4x8', [15, 1.22, -15], Math.PI / 2, {
    phase: 'installed',
    label: 'installed plywood panel',
    pose: { p: [15, 1.22, -15], yaw: Math.PI / 2, roll: Math.PI / 2 },
  });
  rt.mark('construction', { installed: PANEL_ID });
  return true;
}

const walk = (rt: Runtime, actor: string, x: number, z: number, level?: number) =>
  rt.submit('walk_to', level === undefined ? { actor, x, z } : { actor, x, z, level });

export const SCENARIOS: Scenario[] = [
  {
    name: 'wall',
    title: 'Wall avoidance',
    description: 'p1 crosses to the far side of an 8 m wall; plans round it before contact.',
    scene: () => provingGround(),
    humans: () => [human('p1', -18, -15, { yaw: 0 })],
    start: (rt) => void walk(rt, 'p1', -12, -15),
    maxTicks: 20 * 60,
    focus: [-15, -15, 9, 70],
    capture: [0.5],
    expect: (rt) => [allCompleted(rt), noViolations(rt)],
  },
  {
    name: 'u-trap',
    title: 'U-shaped trap',
    description: 'p1 starts inside a cup; the goal is behind its back wall. Global planning exits via the opening.',
    scene: () => provingGround(),
    humans: () => [human('p1', -15, 12, { yaw: Math.PI / 2 })],
    start: (rt) => void walk(rt, 'p1', -15, 20),
    maxTicks: 20 * 60,
    focus: [-15, 12, 10, -60],
    capture: [0.35],
    expect: (rt) => [allCompleted(rt), noViolations(rt)],
  },
  {
    name: 'narrow-passage',
    title: 'Narrow passage, two walkers',
    description: 'n1 and s1 approach a 1.0 m gap from opposite sides; one yields, single file, no overlap.',
    scene: () => provingGround(),
    humans: () => [human('n1', 15, -20, { yaw: Math.PI / 2 }), human('s1', 15, -10, { yaw: -Math.PI / 2 })],
    start: (rt) => {
      walk(rt, 'n1', 15, -10.5);
      walk(rt, 's1', 15, -19.5);
    },
    maxTicks: 20 * 90,
    focus: [15, -15, 8, 35],
    capture: [0.3, 0.6],
    expect: (rt) => {
      const yields = recs(rt).map((r) => r.history.filter((h) => h.status === 'blocked').length);
      return [
        allCompleted(rt),
        noViolations(rt),
        { ok: yields.some((y) => y >= 1), message: `someone yielded (blocked counts ${yields})` },
        { ok: yields.every((y) => y <= 1), message: 'no yield/resume flip-flop' },
      ];
    },
  },
  {
    name: 'stairs',
    title: 'Stairs, oblique approach',
    description: 'p1 starts beside stairs A; walks to the bottom entry, aligns, climbs the real steps, exits on the deck.',
    scene: () => provingGround(),
    humans: () => [human('p1', 3.5, 12.5)],
    start: (rt) => void walk(rt, 'p1', 10, 10, 1),
    maxTicks: 20 * 120,
    focus: [5, 10, 7, 105],
    capture: [0.3, 0.55],
    expect: (rt) => [allCompleted(rt), noViolations(rt), onLevel(rt, 'p1', 1), usedPhase(rt, 'align'), usedPhase(rt, 'climb'),
      { ok: Math.abs(rt.world.entities.p1.pose.p[1] - DECK_Y) < 1e-6, message: 'p1 stands at deck height' }],
  },
  {
    name: 'deck-to-ground',
    title: 'Multi-level: deck to ground below',
    description: 'p1 on the deck walks to a ground point directly below it; must descend stairs A, never drop through.',
    scene: () => provingGround(),
    humans: () => [human('p1', 12, 11.5, { level: 1, y: DECK_Y, yaw: Math.PI })],
    start: (rt) => void walk(rt, 'p1', 10, 8.5, 0),
    maxTicks: 20 * 120,
    focus: [7, 9, 9, 115],
    capture: [0.3, 0.5],
    expect: (rt) => [allCompleted(rt), noViolations(rt), onLevel(rt, 'p1', 0), usedPhase(rt, 'climb')],
  },
  {
    name: 'incomplete-stairs',
    title: 'Incomplete stairs (expected failure)',
    description: 'Stairs A treads 5–12 and stairs B treads 6–9 are missing. p1 asks to reach the deck: rejected with a diagnostic naming the stairs, no movement.',
    scene: () => provingGround({ stairsAUsable: false }),
    humans: () => [human('p1', 20, 11, { yaw: Math.PI })],
    start: (rt) => void walk(rt, 'p1', 10, 10, 1),
    maxTicks: 20,
    focus: [14, 10, 10, 60],
    expect: (rt) => {
      const r = recs(rt)[0];
      const p = rt.world.entities.p1.pose.p;
      return [
        { ok: r?.status === 'failed' && r.diagnostic?.code === 'route.link-unusable', message: `walk_to failed with route.link-unusable (got ${r?.status} ${r?.diagnostic?.code})` },
        { ok: /stairs-(a|b)/.test(r?.diagnostic?.message ?? ''), message: `diagnostic names the stairs: "${r?.diagnostic?.message}"` },
        { ok: p[0] === 20 && p[2] === 11, message: 'p1 did not move' },
        noViolations(rt),
      ];
    },
  },
];

export const PANEL_TICK = 20;
SCENARIOS.push(
  {
    name: 'construction',
    title: 'Construction mid-walk',
    description: `p1 heads through the 1 m gap; at tick ${PANEL_TICK} an installed plywood panel is dropped into it (or press "Drop panel"). The route is invalidated and replanned once, round the wall.`,
    scene: () => provingGround(),
    humans: () => [human('p1', 15, -22, { yaw: Math.PI / 2 })],
    start: (rt) => void walk(rt, 'p1', 15, -8),
    tick: (rt) => {
      if (rt.tick === PANEL_TICK) dropPanel(rt);
    },
    maxTicks: 20 * 120,
    focus: [15, -15, 11],
    capture: [0.15, 0.5],
    expect: (rt) => {
      const r = recs(rt)[0];
      return [allCompleted(rt), noViolations(rt), { ok: r?.outputs?.replans === 1, message: `replanned once (replans=${r?.outputs?.replans})` }];
    },
  },
  {
    name: 'trio',
    title: 'Three walkers (perf baseline)',
    description: 'n1/s1 through the narrow passage while p1 escapes the U-trap — the determinism set.',
    scene: () => provingGround(),
    humans: () => [human('n1', 15, -20, { yaw: Math.PI / 2 }), human('s1', 15, -10, { yaw: -Math.PI / 2 }), human('p1', -15, 12)],
    start: (rt) => {
      walk(rt, 'n1', 15, -10.5);
      walk(rt, 's1', 15, -19.5);
      walk(rt, 'p1', -15, 20);
    },
    maxTicks: 20 * 120,
    focus: [0, -2, 26],
    expect: (rt) => [allCompleted(rt), noViolations(rt)],
  },
  stress(30),
  buildBay,
  handUp,
  campfireEvening,
  meal,
  body,
  ...yearWalkabouts(),
  yearBuild,
  yearBuildHouse,
  solarPaint,
);

/**
 * N people wander: each idle person gets walk_to a seeded random reachable
 * point (20 % on the deck). Lab-local rng so the world rng is untouched.
 */
export function stress(n: number): Scenario {
  const rng = { st: seedRng('lab-stress') };
  const rand = () => nextRandom(rng.st);
  const standable = (rt: Runtime, level: number, x: number, z: number, room: number) => {
    const sp = rt.services.spatial as Spatial;
    sp.sync(rt.world);
    const g = sp.level(level);
    return !!g && clearanceAt(g, [x, z]) >= room;
  };
  const pick = (rt: Runtime, id: string) => {
    const deck = rand() < 0.2;
    const [x, z] = deck ? [6.6 + rand() * 6.8, 7.4 + rand() * 5.2] : [-27 + rand() * 54, -27 + rand() * 54];
    const level = deck ? 1 : 0;
    if (!standable(rt, level, x, z, 0.5)) return;
    rt.submit('walk_to', { actor: id, x, z, level });
  };
  return {
    name: `stress-${n}`,
    title: `Stress: ${n} wanderers`,
    description: `${n} people walk_to seeded random reachable points forever (20 % to the deck). Perf + emergent-interaction soak.`,
    scene: () => provingGround(),
    humans: (base) => {
      rng.st = seedRng('lab-stress');
      const sp = new Spatial(base);
      sp.sync({ entities: {} } as never);
      const g = sp.level(0)!;
      const out: Entity[] = [];
      while (out.length < n) {
        const x = -27 + rand() * 54, z = -27 + rand() * 54;
        if (clearanceAt(g, [x, z]) < 0.6 || out.some((o) => Math.hypot(o.pose.p[0] - x, o.pose.p[2] - z) < 1.5)) continue;
        out.push(human(`w${String(out.length).padStart(2, '0')}`, x, z, { yaw: rand() * 6.28 - 3.14 }));
      }
      return out;
    },
    start: () => {},
    tick: (rt) => {
      if (rt.tick % 5) return; // re-target every 0.25 s
      for (const e of Object.values(rt.world.entities)) if (e.kind === 'human' && !e.human!.task) pick(rt, e.id);
    },
    continuous: true,
    maxTicks: 20 * 60,
    focus: [0, 0, 30],
    expect: (rt) => [noViolations(rt)],
  };
}

export const scenarioByName = (name: string) => SCENARIOS.find((s) => s.name === name);
