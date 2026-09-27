// End-of-tick invariants (spec §31). They never correct anything — they
// record violations so rehearsal reports and tests can fail loudly.
import type { Diagnostic } from '../actions/types.ts';
import { clearanceAt, nearestBlocker } from '../spatial/grid.ts';
import type { Spatial } from '../spatial/service.ts';
import type { Invariant, Runtime } from './runtime.ts';
import { def, HUMAN_RADIUS } from '../world/catalog.ts';
import { angleDelta, type Vec3 } from '../core/math.ts';
import type { WorldState } from '../world/types.ts';

const TOL = 0.03;

export const humanStaticClearance: Invariant = (rt: Runtime) => {
  const sp = rt.services.spatial as Spatial;
  sp.sync(rt.world);
  const out: Diagnostic[] = [];
  for (const e of Object.values(rt.world.entities)) {
    if (e.kind !== 'human' || !e.human || e.human.activity.startsWith('climb')) continue;
    const g = sp.level(e.human.level);
    if (!g) continue;
    const c = clearanceAt(g, [e.pose.p[0], e.pose.p[2]]);
    if (c < HUMAN_RADIUS - TOL)
      out.push({
        code: 'collision.human-static',
        message: `${e.id} body overlaps static geometry (clearance ${c.toFixed(2)} m < ${HUMAN_RADIUS} m) near ${nearestBlocker(g, [e.pose.p[0], e.pose.p[2]]) ?? 'the floor edge'} at (${e.pose.p[0].toFixed(2)}, ${e.pose.p[2].toFixed(2)}) level ${e.human.level} activity ${e.human.activity}`,
        subjects: [e.id],
        at: e.pose.p,
      });
  }
  return out;
};

export const humanHumanSeparation: Invariant = (rt: Runtime) => {
  const hs = Object.values(rt.world.entities).filter((e) => e.kind === 'human' && e.human);
  const out: Diagnostic[] = [];
  for (let i = 0; i < hs.length; i++)
    for (let j = i + 1; j < hs.length; j++) {
      const a = hs[i], b = hs[j];
      if (a.human!.level !== b.human!.level) continue;
      if (Math.abs(a.pose.p[1] - b.pose.p[1]) > 1.0) continue;
      const d = Math.hypot(a.pose.p[0] - b.pose.p[0], a.pose.p[2] - b.pose.p[2]);
      if (d < 2 * HUMAN_RADIUS - 0.08)
        out.push({ code: 'collision.human-human', message: `${a.id} and ${b.id} overlap (${d.toFixed(2)} m apart)`, subjects: [a.id, b.id], at: a.pose.p });
    }
  return out;
};

export const noUnsupported: Invariant = (rt: Runtime) =>
  Object.values(rt.world.entities)
    .filter((e) => e.kind === 'component' && e.support?.kind === 'none')
    .map((e) => ({ code: 'support.unsupported', message: `${e.id} (${e.def}) has no support`, subjects: [e.id], at: e.pose.p }));

export const MAX_STEP_PER_TICK = 0.6; // m: far above any walking / carrying / climbing speed × DT

/** Poses at the end of the previous tick, per runtime (only compared across consecutive ticks of the same world object). */
const lastPoses = new WeakMap<Runtime, { tick: number; world: WorldState; poses: Map<string, { p: Vec3; yaw: number; ext: number }> }>();

/**
 * No person or carried component moves more than MAX_STEP_PER_TICK in one tick (review C1): catches
 * every teleport class (formation flips, snaps, lerps with a wrong origin). For carried components the
 * rotational displacement of the farthest point (|Δyaw| × half the largest extent) counts too.
 */
export const maxStepPerTick: Invariant = (rt: Runtime) => {
  const prev = lastPoses.get(rt);
  const valid = !!prev && prev.world === rt.world && prev.tick === rt.tick - 1;
  const poses = new Map<string, { p: Vec3; yaw: number; ext: number }>();
  const out: Diagnostic[] = [];
  for (const e of Object.values(rt.world.entities)) {
    const human = e.kind === 'human' && !!e.human;
    if (!human && !(e.kind === 'component' && e.phase === 'carried')) continue;
    const ext = human ? 0 : Math.max(...def(e.def).size) / 2;
    const cur = { p: [e.pose.p[0], e.pose.p[1], e.pose.p[2]] as Vec3, yaw: e.pose.yaw, ext };
    poses.set(e.id, cur);
    const q = valid ? prev!.poses.get(e.id) : undefined;
    if (!q) continue;
    const lin = Math.hypot(cur.p[0] - q.p[0], cur.p[1] - q.p[1], cur.p[2] - q.p[2]);
    const d = lin + Math.abs(angleDelta(q.yaw, cur.yaw)) * ext;
    if (d > MAX_STEP_PER_TICK)
      out.push({
        code: 'motion.teleport',
        message: `${e.id} moved ${d.toFixed(2)} m in one tick (max ${MAX_STEP_PER_TICK} m) from (${q.p[0].toFixed(2)}, ${q.p[2].toFixed(2)}) to (${cur.p[0].toFixed(2)}, ${cur.p[2].toFixed(2)})`,
        subjects: [e.id],
        at: cur.p,
      });
  }
  lastPoses.set(rt, { tick: rt.tick, world: rt.world, poses });
  return out;
};

/** Scenario set-up moved entities by hand (not through an action): don't compare motion across this tick. */
export function forgetMotion(rt: Runtime) {
  lastPoses.delete(rt);
}

export const DEFAULT_INVARIANTS = [humanStaticClearance, humanHumanSeparation, noUnsupported, maxStepPerTick];
