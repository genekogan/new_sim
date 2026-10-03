// Bounded ground-mat sleep. Ordinary walk owns approach/return; the physical
// child owns the person and mat through continuous lie/wake. No rig targets.
import { z } from 'zod';
import type { ActionDef, ActionStatus, Diagnostic, StepResult } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Entity, HumanState } from '../world/types.ts';
import type { Spatial } from '../spatial/service.ts';
import { add2, sub2, scale2, dist2, rot2, heading, angleDelta, obbCorners, obbOverlap, pointInObb, hypot, type OBB2, type Vec2 } from '../core/math.ts';
import { HUMAN_PROFILE } from '../spatial/types.ts';
import { heldBy } from '../items/model.ts';

/** 0=lying, 1=standing; renderer maps its own pose coordinates. */
export type SleepPose = NonNullable<HumanState['sleepPose']>;
export interface SleepParams { actor: string; mat: string; duration: number; returnTo?: Vec2 }
export type SleepMode = 'approaching' | 'lying-down' | 'sleeping' | 'waking' | 'returning' | 'draining' | 'paused' | 'waiting' | 'completed';
type Mat = { anchor: Vec2; yaw: number; area: OBB2 };
type Hold = { id: string; p: SleepParams; mat: Mat; standingFraction: number; slept: number; phase: 'approaching' | 'lying-down' | 'sleeping' | 'waking'; child?: string; error?: Diagnostic; stop: boolean };
type Purpose = { id: string; p: SleepParams; mode: SleepMode; child?: string; owned: string[]; elapsed: number; error?: Diagnostic; ending: boolean; draining: boolean };
type Store = { purposes: Record<string, Purpose>; holds: Record<string, Hold> };
const store = (rt: Runtime): Store => (rt.services.sleeps ??= { purposes: {}, holds: {} }) as Store;
const humanState = (e: Entity) => e.human!;
const position = (e: Entity): Vec2 => [e.pose.p[0], e.pose.p[2]];
const issue = (code: string, message: string, subjects: string[]): Diagnostic => ({ code: `sleep.${code}`, message, subjects });
export const SLEEP_TRANSITION_SECONDS = 2.1;
/** Shared physical separation margin for sleeper OBBs and ordinary circular people. */
export const SLEEP_BODY_MARGIN = 0.05;
/** Conservative union of major body volumes during the existing prone/rise adapter.
 * Local forward runs -1.85..1.15 m; lateral clearance is 0.6 m either side.
 * A sleep mat must contain the whole union, not just the standing feet. */
export function sleepEnvelope(e: Entity): OBB2 | null {
  return e.human && humanState(e).sleepPose ? bodyEnvelope(position(e), e.pose.yaw) : null;
}
export function bodyEnvelope(anchor: Vec2, yaw: number): OBB2 {
  return { c: add2(anchor, rot2([-0.35, 0], yaw)), half: [1.5, 0.6], yaw };
}
export function gapToSleep(e: Entity, p: Vec2): number | null {
  const o = sleepEnvelope(e); if (!o) return null;
  return gapToSleepEnvelope(o, p);
}
/** Euclidean distance to the closed major-body rectangle, including rounded
 * corner distance. Callers compare against HUMAN_PROFILE.radius + margin for
 * ordinary people; sleeping bodies use OBB overlap with the same margin. */
export function gapToSleepEnvelope(o: OBB2, p: Vec2): number {
  const q = rot2(sub2(p, o.c), -o.yaw);
  return hypot(Math.max(0, Math.abs(q[0]) - o.half[0]), Math.max(0, Math.abs(q[1]) - o.half[1]));
}
function matOf(rt: Runtime, id: string): Mat | Diagnostic {
  const r = rt.world.regions[id];
  if (!r || r.kind !== 'work-area' || (r.level ?? 0) !== 0 || r.polygon.length !== 4)
    return issue('mat', `${id} must be an explicitly authored four-corner ground work-area mat`, [id]);
  const [a, b, c, d] = r.polygon, edge = sub2(b, a), yaw = heading(edge);
  const centre = scale2(add2(a, c), 0.5), along = dist2(a, b), across = dist2(b, c);
  const area: OBB2 = { c: centre, half: [along / 2, across / 2], yaw };
  if (along < 3 || across < 1.2 || along > 4 || across > 2 || dist2(add2(a, sub2(c, b)), d) > 1e-6 ||
    Math.abs(rot2(sub2(c, b), -yaw)[0]) > 1e-6)
    return issue('mat-shape', `${id} must be a rectangular 3–4 m by 1.2–2 m ground mat with its first edge along the body`, [id]);
  return { area, yaw, anchor: add2(centre, rot2([0.35, 0], yaw)) };
}
function clearance(rt: Runtime, p: SleepParams, mat: Mat): Diagnostic | undefined {
  const sp = rt.services.spatial as Spatial | undefined;
  if (!sp) return issue('spatial', `${p.mat} needs a spatial scene to prove ground support`, [p.actor, p.mat]);
  sp.sync(rt.world);
  const box = bodyEnvelope(mat.anchor, mat.yaw);
  // Convex containment proves the entire footprint, including any tiny gap a
  // sampled floor check could miss. One existing ground rectangle must contain
  // it; adjoining surfaces and elevated beds are deliberately unsupported.
  const corners = obbCorners(box);
  if (!corners.every(q => pointInObb(q, mat.area, 1e-7)) || !sp.scene.surfaces.some(s => s.level === 0 && Math.abs(s.y) < 1e-6 && corners.every(q => pointInObb(q, s.obb, 1e-7))))
    return issue('unsupported', `${p.mat} lacks one continuous ground support rectangle under ${p.actor}'s full lie/rise envelope`, [p.actor, p.mat]);
  for (const o of sp.scene.obstacles) if (o.y1 > 0.005 && o.y0 < HUMAN_PROFILE.height && obbOverlap(box, o.obb, 0.03))
    return issue('blocked', `${o.id} intersects ${p.actor}'s full lie/rise envelope on ${p.mat}`, [p.actor, p.mat, o.id]);
  for (const e of Object.values(rt.world.entities)) {
    if (!e.human || e.id === p.actor || e.human.level !== 0 || Math.abs(e.pose.p[1]) > 1) continue;
    const occupied = sleepEnvelope(e);
    const overlaps = occupied ? obbOverlap(box, occupied, SLEEP_BODY_MARGIN)
      : gapToSleepEnvelope(box, position(e)) <= HUMAN_PROFILE.radius + SLEEP_BODY_MARGIN;
    if (overlaps) return issue('occupied', `${e.id} occupies the lie/rise space of ${p.mat}`, [p.actor, p.mat, e.id]);
  }
}
function ready(rt: Runtime, p: SleepParams): Diagnostic | undefined {
  const e = rt.world.entities[p.actor];
  if (!e?.human) return issue('actor', `${p.actor} must be an existing person`, [p.actor]);
  if (e.human.level !== 0 || Math.abs(e.pose.p[1]) > 1e-6 || e.human.on || e.human.riding)
    return issue('ground', `${p.actor} must stand on ordinary ground before sleeping on ${p.mat}`, [p.actor, p.mat]);
  const held = heldBy(rt.world, p.actor);
  if (e.human.grip || held.length || Object.keys(e.human.hands ?? {}).length)
    return issue('hands', `${p.actor} must have both hands free before sleeping on ${p.mat}`, [p.actor, ...held.map(h => h.item.id)]);
  if (e.human.activity !== 'idle' || rt.holder(`actor:${p.actor}`).length)
    return issue('busy', `${p.actor} is busy with ${e.human.task ?? e.human.activity}`, [p.actor]);
}
function admission(rt: Runtime, p: SleepParams): Mat | Diagnostic {
  const bad = ready(rt, p); if (bad) return bad;
  const mat = matOf(rt, p.mat); if ('code' in mat) return mat;
  const geo = clearance(rt, p, mat); if (geo) return geo;
  const holders = rt.holder(`sleep-mat:${p.mat}`);
  if (holders.length) return issue('reserved', `${p.mat} is reserved by ${holders.join(', ')}`, [p.mat, ...holders]);
  const sp = rt.services.spatial as Spatial;
  for (const target of [mat.anchor, ...(p.returnTo ? [p.returnTo] : [])]) {
    const route = sp.route(rt.world, HUMAN_PROFILE, { level: 0, p: position(rt.world.entities[p.actor]) }, { level: 0, p: target });
    if (!route.ok) return issue('route', `${p.actor} cannot reach ${p.mat}/return: ${route.diagnostic.message}`, [p.actor, p.mat]);
    if (route.route.legs.some(l => l.kind === 'link' || l.level !== 0)) return issue('route-level', `${p.actor}'s sleep approach and return must remain on ordinary ground`, [p.actor, p.mat]);
  }
  return mat;
}
/** End-of-tick read-only safety hook for root's invariant adapter. Includes
 * actual pose/support and major-volume geometry, with no self obstacle. */
export function sleepSafetyIssue(rt: Runtime, e: Entity): Diagnostic | undefined {
  const pose = e.human ? humanState(e).sleepPose : undefined; if (!pose) return;
  if (!Number.isFinite(pose.standingFraction) || pose.standingFraction < 0 || pose.standingFraction > 1)
    return issue('pose-range', `${e.id} has invalid standingFraction on ${pose.mat}; supported sleep requires finite 0–1 progress`, [e.id, pose.mat]);
  const task = e.human!.task, record = task ? rt.records.get(task) : undefined;
  const binding = record?.params as Partial<SleepParams> | undefined;
  if (!task || !record || record.verb !== 'sleep_on_mat' || !rt.isActive(task) ||
      binding?.actor !== e.id || binding?.mat !== pose.mat ||
      !rt.holder(`actor:${e.id}`).includes(task) || !rt.holder(`sleep-mat:${pose.mat}`).includes(task))
    return issue('ownership', `${e.id}'s sleep pose on ${pose.mat} lacks one active physical sleep action owning both actor and mat`, [e.id, pose.mat, ...(task ? [task] : [])]);
  const mat = matOf(rt, pose.mat); if ('code' in mat) return mat;
  if (e.human!.level !== 0 || Math.abs(e.pose.p[1]) > 1e-6 || e.human!.on || e.human!.riding ||
      dist2(position(e), mat.anchor) > 0.03 || Math.abs(angleDelta(e.pose.yaw, mat.yaw)) > 0.03)
    return issue('anchor-support', `${e.id} left the unchanged ordinary-ground anchor of ${pose.mat} while lying/rising`, [e.id, pose.mat]);
  if (e.human!.grip || heldBy(rt.world, e.id).length || Object.keys(e.human!.hands ?? {}).length)
    return issue('hands', `${e.id} acquired an object or hand target during supported sleep on ${pose.mat}`, [e.id, pose.mat]);
  return clearance(rt, { actor: e.id, mat: pose.mat, duration: 1 }, mat);
}
const ident = z.string().min(1).max(80), point = z.tuple([z.number().min(-500).max(500), z.number().min(-500).max(500)]);
const schema = z.strictObject({ actor: ident, mat: ident, duration: z.number().min(0.05).max(600), returnTo: point.optional() });
function publish(rt: Runtime, ex: Hold) {
  const e = rt.world.entities[ex.p.actor], h = humanState(e);
  h.task = ex.id; delete h.speed;
  h.activity = ex.phase === 'lying-down' ? 'sleep-lie-down' : ex.phase === 'waking' ? 'sleep-wake-up' : 'sleep';
  h.sleepPose = { mat: ex.p.mat, standingFraction: ex.standingFraction };
}
function clearPose(rt: Runtime, ex: Hold) {
  const h = humanState(rt.world.entities[ex.p.actor]);
  if (h.task === ex.id) { delete h.sleepPose; delete h.task; delete h.speed; h.activity = 'idle'; }
}
function wake(ex: Hold) { ex.stop = true; if (ex.phase !== 'approaching') ex.phase = 'waking'; }
export const sleepHold: ActionDef<SleepParams, Mat, Hold> = {
  verb: 'sleep_on_mat', description: 'Physically approach an authored clear ground mat, lie prone, sleep, then rise before releasing it.',
  schema, drivesReservedHands: false,
  reservations: (_w, p) => [{ resource: `actor:${p.actor}`, mode: 'exclusive' }, { resource: `sleep-mat:${p.mat}`, mode: 'exclusive' }],
  plan(rt, p) { const mat = admission(rt, p); return 'code' in mat ? { ok: false, diagnostic: mat } : { ok: true, program: mat }; },
  start(rt, p, mat, id) {
    const ex: Hold = { id, p: structuredClone(p), mat, standingFraction: 1, slept: 0, phase: 'approaching', stop: false };
    store(rt).holds[id] = ex;
    const rec = rt.submit('walk_to', { actor: p.actor, x: mat.anchor[0], z: mat.anchor[1], level: 0, face: mat.yaw }, { parent: id, preempt: false });
    ex.child = rec.id; return ex;
  },
  step(rt, ex, dt): StepResult {
    if (ex.phase === 'approaching') {
      const child = rt.records.get(ex.child!)!;
      if (rt.isActive(child.id)) return { status: 'running', phase: 'approaching' };
      if (ex.stop) { clearPose(rt, ex); return { status: 'completed', outputs: { elapsed: ex.slept } }; }
      if (child.status !== 'completed') return { status: 'failed', diagnostic: issue('approach', `${ex.p.actor}'s approach to ${ex.p.mat} ended ${child.status}`, [ex.p.actor, ex.p.mat, child.id]) };
      const e = rt.world.entities[ex.p.actor];
      if (dist2(position(e), ex.mat.anchor) > 0.03 || Math.abs(angleDelta(e.pose.yaw, ex.mat.yaw)) > 0.03)
        return { status: 'failed', diagnostic: issue('arrival', `${ex.p.actor} did not physically reach the supported anchor of ${ex.p.mat}`, [ex.p.actor, ex.p.mat]) };
      const bad = clearance(rt, ex.p, ex.mat); if (bad) return { status: 'failed', diagnostic: bad };
      ex.phase = 'lying-down';
    }
    const live = matOf(rt, ex.p.mat);
    const bad = 'code' in live ? live : dist2(live.anchor, ex.mat.anchor) > 1e-6 || Math.abs(angleDelta(live.yaw, ex.mat.yaw)) > 1e-6
      ? issue('mat-moved', `${ex.p.mat} changed after ${ex.p.actor} committed to its supported anchor`, [ex.p.actor, ex.p.mat])
      // A published sleep pose's safety check already includes full clearance.
      // Before its first publication the direct clearance check is still needed.
      : rt.world.entities[ex.p.actor].human?.sleepPose
        ? sleepSafetyIssue(rt, rt.world.entities[ex.p.actor])
        : clearance(rt, ex.p, live);
    if (bad) { ex.error = bad; return { status: 'blocked', diagnostic: bad }; }
    ex.error = undefined;
    if (ex.phase === 'lying-down') { ex.standingFraction = Math.max(0, ex.standingFraction - dt / SLEEP_TRANSITION_SECONDS); if (ex.standingFraction < 1e-8) { ex.standingFraction = 0; ex.phase = 'sleeping'; } }
    else if (ex.phase === 'sleeping') { ex.slept = Math.min(ex.p.duration, ex.slept + dt); if (ex.slept >= ex.p.duration - 1e-8) { ex.slept = ex.p.duration; ex.phase = 'waking'; } }
    else if (ex.phase === 'waking') {
      ex.standingFraction = Math.min(1, ex.standingFraction + dt / SLEEP_TRANSITION_SECONDS);
      if (ex.standingFraction >= 1 - 1e-8) { ex.standingFraction = 1; clearPose(rt, ex); return ex.error ? { status: 'failed', diagnostic: ex.error } : { status: 'completed', outputs: { elapsed: ex.slept } }; }
    }
    publish(rt, ex); return { status: 'running', phase: ex.phase };
  },
  cancel(rt, ex) {
    wake(ex);
    if (ex.phase === 'approaching') { if (ex.child && rt.isActive(ex.child)) rt.cancel(ex.child); clearPose(rt, ex); return { ok: true, deferred: !!ex.child && rt.isActive(ex.child) }; }
    return { ok: true, deferred: true };
  },
  yieldTo: (_rt, self) => [self.id],
  resumable: 'Ground sleep has runtime-local explicit interruption/return; active snapshot restoration is outside this bounded slice.',
};
function absorb(rt: Runtime, ex: Purpose) {
  if (!ex.child) return;
  const h = store(rt).holds[ex.child];
  if (h) ex.elapsed = Math.min(ex.p.duration, ex.elapsed + h.slept);
  ex.child = undefined;
}
function drain(rt: Runtime, ex: Purpose): StepResult {
  if (ex.child && rt.isActive(ex.child)) { rt.cancel(ex.child); if (rt.isActive(ex.child)) return { status: 'running', phase: 'draining' }; }
  absorb(rt, ex); ex.draining = false;
  if (ex.ending) { ex.mode = 'completed'; return { status: 'completed', outputs: { ended: true, elapsed: ex.elapsed } }; }
  ex.mode = ex.error ? 'waiting' : 'paused';
  return ex.error ? { status: 'blocked', diagnostic: ex.error } : { status: 'running', phase: 'paused' };
}
export const sleep: ActionDef<SleepParams, null, Purpose> = {
  verb: 'sleep', description: 'Retain one bounded sleep/return purpose through explicit Pause/Resume and director handoff.', schema, drivesReservedHands: false,
  reservations: (_w, p) => [{ resource: `sleep-purpose:${p.actor}`, mode: 'exclusive' }],
  plan(rt, p) { const mat = admission(rt, p); return 'code' in mat ? { ok: false, diagnostic: mat } : { ok: true, program: null }; },
  start(rt, p, _m, id) { const ex: Purpose = { id, p: structuredClone(p), mode: 'approaching', owned: [], elapsed: 0, ending: false, draining: false }; store(rt).purposes[id] = ex; return ex; },
  onDirective(_rt, ex, by, claims, ancestors) {
    // Sleep admission/control is not independent direction. Runtime calls this
    // before plan(): a refused repeat physical sleep must not wake the old one.
    if (ancestors.includes(ex.id) || ['sleep', 'sleep_on_mat', 'sleep_control'].includes(by.verb) || !claims.some(c => c.resource === `actor:${ex.p.actor}`) || ['paused', 'waiting', 'completed'].includes(ex.mode)) return;
    ex.error = issue('directed-away', `${by.verb} ${by.id} takes priority; ${ex.p.actor}'s unfinished sleep/return waits for Resume`, [ex.p.actor, by.id]);
    ex.draining = true; ex.mode = 'draining';
  },
  yieldTo: (_rt, _self, holder) => [holder.id],
  step(rt, ex): StepResult {
    if (ex.draining || ex.ending) return drain(rt, ex);
    if (ex.mode === 'paused' || ex.mode === 'waiting') return ex.error ? { status: 'blocked', diagnostic: ex.error } : { status: 'running', phase: ex.mode };
    if (!ex.child) {
      const remaining = ex.p.duration - ex.elapsed;
      if (remaining <= 1e-8 && !ex.p.returnTo) { ex.mode = 'completed'; return { status: 'completed', outputs: { elapsed: ex.elapsed, returned: false } }; }
      const rec = remaining > 1e-8
        ? rt.submit('sleep_on_mat', { ...ex.p, duration: remaining }, { parent: ex.id, preempt: false })
        : rt.submit('walk_to', { actor: ex.p.actor, x: ex.p.returnTo![0], z: ex.p.returnTo![1], level: 0 }, { parent: ex.id, preempt: false });
      ex.child = rec.id; ex.owned.push(rec.id); ex.mode = remaining > 1e-8 ? 'approaching' : 'returning';
    }
    const rec = rt.records.get(ex.child!)!, hold = store(rt).holds[ex.child!];
    if (rt.isActive(rec.id)) { if (hold) ex.mode = hold.phase; return rec.status === 'blocked' && hold?.error ? { status: 'blocked', diagnostic: hold.error } : { status: 'running', phase: ex.mode }; }
    const wasReturn = ex.mode === 'returning'; absorb(rt, ex);
    if (rec.status !== 'completed') { ex.error = rec.diagnostic ?? issue('child-stopped', `${rec.id} ended ${rec.status}; sleep/return is retained`, [ex.p.actor, rec.id]); ex.mode = 'waiting'; return { status: 'blocked', diagnostic: ex.error }; }
    if (wasReturn) { ex.mode = 'completed'; return { status: 'completed', outputs: { elapsed: ex.elapsed, returned: true } }; }
    return { status: 'running', phase: 'waking' };
  },
  cancel(rt, ex) { ex.ending = true; ex.draining = true; ex.mode = 'draining'; return { ok: true, deferred: drain(rt, ex).status !== 'completed' }; },
  resumable: 'Sleep purpose supports explicit runtime-local Pause/Resume; active snapshot restoration is outside scope.',
};
export const sleepControl: ActionDef<{ sleep: string; intent: 'pause' | 'resume' | 'end' }, null, null> = {
  verb: 'sleep_control', description: 'Pause with physical wake/cleanup, resume remaining sleep and return, or terminally end an owned purpose.',
  schema: z.strictObject({ sleep: ident, intent: z.enum(['pause', 'resume', 'end']) }), reservations: () => [],
  plan(rt, p) {
    const ex = store(rt).purposes[p.sleep];
    if (!ex || !rt.isActive(ex.id) || ex.ending) return { ok: false, diagnostic: issue('inactive', `${p.sleep} cannot accept ${p.intent}`, [p.sleep]) };
    if (p.intent === 'resume') {
      if (!['paused', 'waiting'].includes(ex.mode)) return { ok: false, diagnostic: issue('not-paused', `${p.sleep} must finish physical wake/cleanup before Resume`, [p.sleep]) };
      const bad = ready(rt, ex.p); if (bad) return { ok: false, diagnostic: bad };
      if (ex.elapsed < ex.p.duration - 1e-8) { const mat = admission(rt, ex.p); if ('code' in mat) return { ok: false, diagnostic: mat }; }
    }
    return { ok: true, program: null };
  },
  start(rt, p) {
    const ex = store(rt).purposes[p.sleep];
    if (p.intent === 'end') rt.cancel(ex.id);
    else if (p.intent === 'pause') { ex.error = undefined; ex.draining = true; ex.mode = 'draining'; }
    else { ex.error = undefined; ex.child = undefined; ex.mode = ex.elapsed >= ex.p.duration - 1e-8 ? 'returning' : 'approaching'; }
    return null;
  }, step: () => ({ status: 'completed' }), cancel: () => ({ ok: true }), resumable: true,
};
export function readSleep(rt: Runtime, id: string): { action: string; status: ActionStatus; mode: SleepMode; bindings: SleepParams; elapsed: number; remaining: number; ownedActions: string[]; diagnostic?: Diagnostic } | undefined {
  const ex = store(rt).purposes[id], rec = rt.records.get(id); if (!ex || !rec) return;
  const hold = ex.child ? store(rt).holds[ex.child] : undefined, current = hold?.slept ?? 0, elapsed = Math.min(ex.p.duration, ex.elapsed + current), diagnostic = ex.error ?? hold?.error;
  return { action: id, status: rec.status, mode: ex.mode, bindings: structuredClone(ex.p), elapsed, remaining: Math.max(0, ex.p.duration - elapsed), ownedActions: [...ex.owned], ...(diagnostic ? { diagnostic: structuredClone(diagnostic) } : {}) };
}
export const SLEEP_ACTIONS: ActionDef[] = [sleep, sleepHold, sleepControl];
