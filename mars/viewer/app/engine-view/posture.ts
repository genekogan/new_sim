// Handling postures (owner feedback §6): crouch / kneel-ish squat, stand with a load, reach up,
// reach down (bend at the hips over a deck edge), hold high / hold low — as ONE small solver over two
// body degrees of freedom plus a heel raise, chosen per tick from where the hands must go:
//   drop  — pelvis lowered by bending the knees, feet planted (a squat when deep),
//   bend  — torso pitched forward at the hips (the pelvis shifts back a little to balance),
//   rise  — heels up (≤ 6 cm) when the hands must go above the standing reach.
// The solver minimises "hands out of reach" first, then effort, with per-activity preferences
// (style): lift from the knees with the torso upright for ground pickups; bend at the hips to reach
// down from a deck edge; stand tall to reach up. Pure numbers (no three.js), node-testable; the
// renderer (humans.ts) applies the result to the rig and then runs the arm IK (reach honesty: an arm
// whose point is still beyond its length after the best posture hangs; nothing stretches).

/** Rig measurements in the person's frame (metres; f = forward, up = above the floor, lat = right). */
export type Dims = {
  /** Height of the hip joints (UpperLeg origins) above the floor, standing. */
  hipH: number;
  /** Height of the torso-bend pivot (Hips bone). */
  pivotH: number;
  /** Ankle (Foot bone origin) height above the floor when the sole is on it. */
  ankleH: number;
  /** Hip joint → knee → ankle length. */
  legLen: number;
  /** Shoulder-joint midpoint relative to the pivot (standing). */
  sh: { f: number; up: number };
  /**
   * The spine as the pose layer bends it: pivot (Hips) → Abdomen → Torso → shoulder midpoint, each
   * segment (f, up) standing; the bend turns them by 0.6, 0.8 and 1.0 × bend (humans.ts bendTorso).
   */
  chain: { f: number; up: number }[];
  /** Shoulder joint lateral half-width. */
  shHalf: number;
  /** Shoulder → elbow → palm length. */
  armLen: number;
};

export type Style = 'knees' | 'hips' | 'up' | 'walk';
export type Target = { f: number; up: number; lat: number };
export type Posture = { drop: number; bend: number; rise: number };
export const NEUTRAL: Posture = { drop: 0, bend: 0, rise: 0 };

const DEG = Math.PI / 180;
/** Deepest pelvis: hips this high above the floor (a full squat). */
export const SQUAT_HIP = 0.42;
export const RISE_MAX = 0.06;
/** Arm reach the solver plans with (fraction of the arm length; the IK clamps at 0.97). */
const PLAN_REACH = 0.92;

const STYLE: Record<Style, { bendMax: number; wDrop: number; wBend: number; rise: boolean; dropMax?: number }> = {
  knees: { bendMax: 80 * DEG, wDrop: 0.5, wBend: 1.4, rise: false },
  hips: { bendMax: 100 * DEG, wDrop: 0.8, wBend: 0.35, rise: false },
  up: { bendMax: 30 * DEG, wDrop: 4, wBend: 3, rise: true },
  walk: { bendMax: 15 * DEG, wDrop: 4, wBend: 2, rise: false, dropMax: 0.08 },
};

/** Style for an engine activity (engine/construction/handup.ts phases, carry, raise, items). */
export function styleFor(activity: string, walking: boolean): Style {
  if (walking) return 'walk';
  if (activity === 'reach_up' || activity === 'walk-load' || activity === 'push') return 'up';
  if (activity === 'reach_down' || activity === 'take' || activity === 'lay' || activity === 'set_down' || activity === 'reach' || activity === 'serve') return 'hips';
  return 'knees'; // crouch, lift, stand_with_load, carry, support, hold, release, idle with a grip
}

/** Share of the bend reached at each spine joint (Hips, Abdomen, Torso): humans.ts bendTorso. */
export const BEND_SHARE = [0.6, 0.8, 1.0];

/**
 * Shoulder midpoint (f, up above the floor) for a posture, through the bent spine chain. The pelvis
 * shifts back by 0.3 × the shoulders' forward travel to balance a bend (`back`, m).
 */
export function shoulderAt(d: Dims, p: Posture) {
  let f = 0, up = 0;
  d.chain.forEach((sg, i) => {
    const a = p.bend * BEND_SHARE[i], c = Math.cos(a), s = Math.sin(a);
    f += sg.f * c + sg.up * s;
    up += sg.up * c - sg.f * s;
  });
  const back = 0.3 * Math.max(0, f - d.sh.f);
  return { f: f - back, up: d.pivotH - p.drop + p.rise + up, back };
}

/** Distance from each target to its shoulder (targets[i].lat sign picks the side). */
function reachErr(d: Dims, p: Posture, ts: Target[]) {
  const s = shoulderAt(d, p);
  let err = 0, close = 0;
  for (const t of ts) {
    const side = t.lat >= 0 ? 1 : -1;
    const dist = Math.hypot(t.f - s.f, t.up - s.up, t.lat - side * d.shHalf);
    err += Math.max(0, dist - PLAN_REACH * d.armLen);
    close += Math.max(0, 0.4 * d.armLen - dist);
  }
  return { err, close };
}

/** Best posture for `targets` (body frame) under `style`: grid search, deterministic. */
export function solvePosture(d: Dims, ts: Target[], style: Style): Posture {
  if (!ts.length) return NEUTRAL;
  const st = STYLE[style];
  const dropMax = Math.min(st.dropMax ?? Infinity, Math.max(0, d.hipH - SQUAT_HIP));
  let best = NEUTRAL, bc = Infinity;
  const ND = 12, NB = Math.max(1, Math.round(st.bendMax / (5 * DEG)));
  const rises = st.rise ? [0, RISE_MAX / 2, RISE_MAX] : [0];
  for (let i = 0; i <= ND; i++)
    for (let j = 0; j <= NB; j++)
      for (const rise of rises) {
        const p = { drop: (dropMax * i) / ND, bend: (st.bendMax * j) / NB, rise };
        const r = reachErr(d, p, ts);
        const cost = 40 * r.err + 30 * r.close + st.wDrop * p.drop + st.wBend * p.bend + 3 * rise;
        if (cost < bc - 1e-9) [best, bc] = [p, cost];
      }
  return best;
}

/** Move `cur` toward `goal` at most `rate` × full range per call (drop in m, bend in rad). */
export function approach(cur: Posture, goal: Posture, k: number): Posture {
  const step = (a: number, b: number, max: number) => a + Math.max(-max, Math.min(max, b - a));
  return { drop: step(cur.drop, goal.drop, 0.55 * k), bend: step(cur.bend, goal.bend, 1.6 * k), rise: step(cur.rise, goal.rise, RISE_MAX * k) };
}
