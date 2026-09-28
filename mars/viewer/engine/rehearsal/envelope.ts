// Region-scoped plan staleness (LAST_MILE LM-003/004, TAKES_AND_PLANS.md "Staleness"). A plan's
// *envelope* is what each of its steps touches, measured on a run of the plan from its own baseline
// checkpoint: the entities and regions its params name, every entity that moves or changes while the
// step is active, and the ground boxes those entities sweep (padded by their size plus MARGIN). A
// physical change between the baseline and a workspace head stales the plan only when it touches a
// step's envelope; a change outside every envelope leaves the plan valid (execute then runs it from
// the head). Changes to the static base, the inventory mode or the RNG state touch every step.
// Deterministic: the envelope is a pure function of (plan, baseline state, that run's take + report).
import { obbCorners } from '../core/math.ts';
import { entityFootprint } from '../spatial/service.ts';
import { CATALOG } from '../world/catalog.ts';
import type { BoundPlan } from '../sequence/types.ts';
import type { Take } from '../take/types.ts';
import { POS_Q } from '../take/types.ts';
import type { Entity, WorldState } from '../world/types.ts';
import type { PhysicalDiff } from './rehearse.ts';

export const ENVELOPE_FORMAT = 'mars-plan-envelope/1';
/** Clearance added around every swept box (a person's radius plus walking clearance). */
export const MARGIN = 0.75;
/** Swept paths are sampled at most this far apart, and consecutive boxes merged up to MAX_BOX on a side. */
const SAMPLE_STEP = 1;
const MAX_BOX = 3;

/** Axis-aligned ground box [x0, z0, x1, z1] (metres). */
export type Box = [number, number, number, number];
export type StepEnvelope = { step: string; entities: string[]; regions: string[]; boxes: Box[] };
export type PlanEnvelope = { format: typeof ENVELOPE_FORMAT; planHash: string; baselineCheckpoint: string; steps: StepEnvelope[] };
/** A step a physical change reaches, and why (entity/region ids with what changed). */
export type AffectedStep = { step: string; causes: string[] };

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Horizontal reach of an entity from its pose origin: half its catalog box's diagonal (any orientation). */
function reach(defId: string): number {
  const s = CATALOG[defId]?.size;
  if (!s) return 1;
  return 0.5 * Math.sqrt(s[0] * s[0] + s[1] * s[1] + s[2] * s[2]);
}

/** Every string / {x, z} / [x, z] in a params value (recursive). */
function scan(v: unknown, strings: Set<string>, points: [number, number][]) {
  if (typeof v === 'string') strings.add(v);
  else if (Array.isArray(v)) {
    if (v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number') points.push([v[0], v[1]]);
    else for (const x of v) scan(x, strings, points);
  } else if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.x === 'number' && typeof o.z === 'number') points.push([o.x, o.z]);
    for (const k of Object.keys(o)) scan(o[k], strings, points);
  }
}

const padBox = (x: number, z: number, pad: number): Box => [x - pad, z - pad, x + pad, z + pad];

/** Boxes covering a polyline of ground points, each padded by `pad`, merged while ≤ MAX_BOX + 2·pad on a side. */
function sweep(points: [number, number][], pad: number): Box[] {
  const dense: [number, number][] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i === 0) {
      dense.push(p);
      continue;
    }
    const q = points[i - 1];
    const dx = p[0] - q[0], dz = p[1] - q[1];
    const n = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dz * dz) / SAMPLE_STEP));
    for (let k = 1; k <= n; k++) dense.push([q[0] + (dx * k) / n, q[1] + (dz * k) / n]);
  }
  const out: Box[] = [];
  let cur: Box | null = null;
  for (const [x, z] of dense) {
    if (cur && Math.max(cur[2], x) - Math.min(cur[0], x) <= MAX_BOX && Math.max(cur[3], z) - Math.min(cur[1], z) <= MAX_BOX) {
      cur = [Math.min(cur[0], x), Math.min(cur[1], z), Math.max(cur[2], x), Math.max(cur[3], z)];
      continue;
    }
    if (cur) out.push(cur);
    cur = [x, z, x, z];
  }
  if (cur) out.push(cur);
  return out.map((b) => [r2(b[0] - pad), r2(b[1] - pad), r2(b[2] + pad), r2(b[3] + pad)]);
}

/** Ground points of an entity's pose track within ticks [a, b] (bracketing samples included). */
function trackPoints(samples: number[][] | undefined, a: number, b: number): [number, number][] {
  if (!samples?.length) return [];
  let i0 = 0, i1 = samples.length - 1;
  while (i0 < samples.length - 1 && samples[i0 + 1][0] <= a) i0++;
  while (i1 > 0 && samples[i1 - 1][0] >= b) i1--;
  return samples.slice(i0, i1 + 1).map((s) => [s[1] / POS_Q, s[3] / POS_Q]);
}

/** Did the entity move (track) or change (discrete field) within ticks [a, b]? */
function activeIn(take: Take, id: string, a: number, b: number): boolean {
  const s = take.tracks[id];
  if (s && s.length > 1) {
    const pts = s.filter((x) => x[0] > a && x[0] <= b);
    if (pts.length) return true;
  }
  return take.changes.some((c) => c[1] === id && c[0] > a && c[0] <= b);
}

/**
 * The plan's per-step envelope from a run of the plan from its baseline (`take`, whose steps are `steps`
 * with absolute submitted/ended ticks). `baseline` is the plan's baseline state.
 */
export function planEnvelope(plan: BoundPlan, baseline: WorldState, take: Take, steps: { id: string; submittedTick?: number; endedTick?: number }[]): PlanEnvelope {
  const ids = new Set(Object.keys(baseline.entities));
  for (const id of Object.keys(take.tracks)) ids.add(id);
  const regionIds = new Set(Object.keys(baseline.regions));
  const byStep = new Map(steps.map((s) => [s.id, s]));
  const named = new Map<string, { entities: Set<string>; regions: Set<string>; points: [number, number][] }>();
  const referenced = new Set<string>();
  for (const s of plan.steps) {
    const strings = new Set<string>();
    const points: [number, number][] = [];
    scan(s.params, strings, points);
    const entities = new Set([...strings].filter((x) => ids.has(x)));
    for (const e of entities) referenced.add(e);
    named.set(s.id, { entities, regions: new Set([...strings].filter((x) => regionIds.has(x))), points });
  }
  const movers = Object.keys(take.tracks).sort();
  const out: StepEnvelope[] = [];
  for (const s of plan.steps) {
    const n = named.get(s.id)!;
    const rep = byStep.get(s.id);
    const a = rep?.submittedTick !== undefined ? rep.submittedTick - take.startTick : 0;
    const b = rep?.endedTick !== undefined ? rep.endedTick - take.startTick : take.ticks;
    const entities = new Set(n.entities);
    // unnamed movers (a load on forks, a crowd member stepping aside) belong to every step active while they move
    for (const id of movers) if (!referenced.has(id) && activeIn(take, id, a, b)) entities.add(id);
    const boxes: Box[] = [];
    for (const id of [...entities].sort()) {
      const e0 = baseline.entities[id] ?? take.entities0?.[id];
      const pad = (e0 ? reach(e0.def) : 1) + MARGIN;
      const pts = trackPoints(take.tracks[id], a, b);
      if (!pts.length && e0) pts.push([e0.pose.p[0], e0.pose.p[2]]);
      boxes.push(...sweep(pts, pad));
    }
    for (const p of n.points) boxes.push(padBox(r2(p[0]), r2(p[1]), MARGIN));
    out.push({ step: s.id, entities: [...entities].sort(), regions: [...n.regions].sort(), boxes });
  }
  return { format: ENVELOPE_FORMAT, planHash: plan.planHash, baselineCheckpoint: plan.baselineCheckpoint, steps: out };
}

/** Ground AABB of an entity's footprint (a person: their disc). */
function entityBox(e: Entity): Box {
  if (e.kind === 'human') {
    const r = reach(e.def) || 0.3;
    return [e.pose.p[0] - r, e.pose.p[2] - r, e.pose.p[0] + r, e.pose.p[2] + r];
  }
  let cs: [number, number][];
  try {
    cs = obbCorners(entityFootprint(e).obb) as [number, number][];
  } catch {
    const r = reach(e.def);
    return [e.pose.p[0] - r, e.pose.p[2] - r, e.pose.p[0] + r, e.pose.p[2] + r];
  }
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of cs) {
    x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z);
  }
  return [x0, z0, x1, z1];
}

function polygonBox(poly: [number, number][]): Box {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of poly) {
    x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z);
  }
  return [x0, z0, x1, z1];
}

const overlaps = (a: Box, b: Box) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

/**
 * Which steps a physical change (baseline `before` → head `after`, with `diff = physicalDiff(before, after)`)
 * reaches. Empty = the change is outside every step's envelope and the plan stays valid.
 */
export function affectedSteps(env: PlanEnvelope, before: WorldState, after: WorldState, diff: PhysicalDiff): AffectedStep[] {
  const global: string[] = [];
  if (diff.base) global.push('static base geometry');
  for (const k of diff.other) global.push(k);
  const changed = new Map(diff.changed.map((c) => [c.id, `${c.id} (${c.fields.join(', ')})`]));
  for (const id of diff.added) changed.set(id, `${id} (added)`);
  for (const id of diff.removed) changed.set(id, `${id} (removed)`);
  const entityBoxes = new Map<string, Box[]>();
  for (const id of changed.keys()) entityBoxes.set(id, [before.entities[id], after.entities[id]].filter((e): e is Entity => !!e).map(entityBox));
  const regionBoxes = new Map<string, Box[]>();
  for (const id of diff.regions) regionBoxes.set(id, [before.regions[id], after.regions[id]].filter((r) => !!r).map((r) => polygonBox(r.polygon)));
  const out: AffectedStep[] = [];
  for (const s of env.steps) {
    const causes = [...global];
    const ents = new Set(s.entities), regs = new Set(s.regions);
    const hit = (bs: Box[]) => bs.some((b) => s.boxes.some((x) => overlaps(b, x)));
    for (const [id, what] of changed) if (ents.has(id) || hit(entityBoxes.get(id)!)) causes.push(what);
    for (const [id, bs] of regionBoxes) if (regs.has(id) || hit(bs)) causes.push(`region ${id}`);
    if (causes.length) out.push({ step: s.step, causes });
  }
  return out;
}
