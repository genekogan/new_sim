// An explicit invitation along one clear ground corridor. Children own movement.
import { z } from 'zod';
import type { ActionDef, ActionStatus, Diagnostic, StepResult } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import { add2, sub2, scale2, dot2, dist2, len2, heading, clamp, type Vec2 } from '../core/math.ts';
import { HUMAN_PROFILE } from '../spatial/types.ts';
import type { Spatial } from '../spatial/service.ts';
import { segmentClearance } from '../spatial/grid.ts';
import { heldBy } from '../items/model.ts';

export interface PairedWalkParams {
  actors: [string, string];
  rendezvous: [Vec2, Vec2];
  destination: [Vec2, Vec2];
  speed: number;
}
export interface PairedWalkControlParams { walk: string; intent: 'pause' | 'resume' | 'end' }
export type PairedWalkMode = 'regrouping' | 'walking' | 'draining' | 'paused' | 'waiting' | 'ending' | 'completed';
export interface PairedWalkReadout {
  action: string; status: ActionStatus; mode: PairedWalkMode; bindings: PairedWalkParams;
  separation: number; participants: { actor: string; progress: number; arrived: boolean }[];
  regroup: [Vec2, Vec2]; ownedActions: string[]; diagnostic?: Diagnostic; waitingReason?: string;
}
type Exec = {
  id: string; p: PairedWalkParams; mode: PairedWalkMode; children: string[]; current: string[];
  regroup: [Vec2, Vec2]; traveled: boolean; error?: Diagnostic; ending: boolean;
  last: [Vec2, Vec2]; stationaryTicks: number;
};
type Store = Record<string, Exec>;
const lookup = (rt: Runtime, id: string): Exec | undefined => (rt.services.pairedWalks as Store | undefined)?.[id];
const diag = (code: string, message: string, subjects: string[], cause?: Diagnostic): Diagnostic => ({
  code: `paired_walk.${code}`, message, subjects, ...(cause ? { details: { cause } } : {}),
});
export const PAIR_MAX_SEPARATION = 1.8;
export const PAIR_STALL_TICKS = 100;
/** New bounded invitation scope, including actual room departure-to-regroup detours. */
export const PAIR_MAX_REGROUP_DISTANCE = 30;
const EPS = 0.03;
const point = (rt: Runtime, actor: string): Vec2 => { const p = rt.world.entities[actor].pose.p; return [p[0], p[2]]; };
const routeVector = (p: PairedWalkParams) => sub2(p.destination[0], p.rendezvous[0]);
function progress(rt: Runtime, p: PairedWalkParams, i: number) {
  const vector = routeVector(p), length = len2(vector);
  return clamp(dot2(sub2(point(rt, p.actors[i]), p.rendezvous[i]), vector) / length, 0, length);
}
function regroupPoints(rt: Runtime, ex: Exec): [Vec2, Vec2] {
  const vector = routeVector(ex.p), length = len2(vector);
  const distance = ex.traveled ? Math.min(progress(rt, ex.p, 0), progress(rt, ex.p, 1)) : 0;
  return ex.p.rendezvous.map(p => add2(p, scale2(vector, distance / length))) as [Vec2, Vec2];
}
function readyIssue(rt: Runtime, p: PairedWalkParams): Diagnostic | undefined {
  for (const actor of p.actors) {
    const e = rt.world.entities[actor], holders = rt.holder(`actor:${actor}`);
    if (!e?.human) return diag('actor', `${actor} must be an existing person`, [actor]);
    if (e.human.level !== 0 || Math.abs(e.pose.p[1]) > 0.01)
      return diag('ground', `${actor} must stand on ground level 0`, [actor]);
    const held = heldBy(rt.world, actor);
    if (e.human.grip || held.length) return diag('hands', `${actor} must release held objects before accepting this walk`, [actor, ...held.map(q => q.item.id)]);
    if (holders.length || e.human.activity !== 'idle')
      return diag('actor-busy', `${actor} is owned by ${holders.join(', ') || e.human.activity}; this invitation cannot interrupt foreign work`, [actor, ...holders]);
  }
}
function geometryIssue(rt: Runtime, p: PairedWalkParams, regroup: [Vec2, Vec2]): Diagnostic | undefined {
  const sp = rt.services.spatial as Spatial | undefined;
  if (!sp) return diag('ground-route', 'Paired walking requires a spatial ground route', [...p.actors]);
  const v = routeVector(p), length = len2(v), gap = sub2(p.rendezvous[1], p.rendezvous[0]);
  if (length < 3 || length > 12 || dist2(v, sub2(p.destination[1], p.rendezvous[1])) > 1e-6 ||
      len2(gap) < 0.8 || len2(gap) > 1.2 || Math.abs(dot2(v, gap)) > 1e-6)
    return diag('authored-route', 'Choose two parallel 3–12 m ground lanes with equal displacement and 0.8–1.2 m lateral spacing', [...p.actors]);
  sp.sync(rt.world);
  for (let i = 0; i < 2; i++) {
    const regroupRoute = sp.route(rt.world, HUMAN_PROFILE, { level: 0, p: point(rt, p.actors[i]) }, { level: 0, p: regroup[i] });
    if (!regroupRoute.ok) return diag('rendezvous', `${p.actors[i]} cannot reach the committed regroup point: ${regroupRoute.diagnostic.message}`, [p.actors[i]], regroupRoute.diagnostic);
    const travelRoute = sp.route(rt.world, HUMAN_PROFILE, { level: 0, p: regroup[i] }, { level: 0, p: p.destination[i] });
    if (!travelRoute.ok) return diag('destination', `${p.actors[i]} cannot reach the committed destination: ${travelRoute.diagnostic.message}`, [p.actors[i]], travelRoute.diagnostic);
    if ([regroupRoute.route, travelRoute.route].some(r => r.legs.some(l => l.kind === 'link' || l.level !== 0)))
      return diag('ground-route', `${p.actors[i]}'s regroup and paired travel must remain on level 0 without traversing access links`, [p.actors[i]]);
    if (regroupRoute.route.length > PAIR_MAX_REGROUP_DISTANCE)
      return diag('rendezvous-scope', `${p.actors[i]}'s regroup route must be ground-only and at most ${PAIR_MAX_REGROUP_DISTANCE} m`, [p.actors[i]]);
  }
  const grid = sp.level(0), centre0 = scale2(add2(regroup[0], regroup[1]), 0.5), centre1 = scale2(add2(p.destination[0], p.destination[1]), 0.5);
  const radius = len2(gap) / 2 + HUMAN_PROFILE.radius + 0.15;
  if (!grid || segmentClearance(grid, centre0, centre1) < radius)
    return diag('corridor', `The committed pair corridor from (${centre0.join(', ')}) to (${centre1.join(', ')}) needs ${radius.toFixed(2)} m clear half-width`, [...p.actors]);
  const segment = sub2(centre1, centre0), square = dot2(segment, segment);
  for (const e of Object.values(rt.world.entities)) {
    if (!e.human || p.actors.includes(e.id) || e.human.level !== 0) continue;
    const at: Vec2 = [e.pose.p[0], e.pose.p[2]], along = square ? clamp(dot2(sub2(at, centre0), segment) / square, 0, 1) : 0;
    if (dist2(at, add2(centre0, scale2(segment, along))) < radius + HUMAN_PROFILE.radius)
      return diag('crowded', `${e.id} occupies the supported pair corridor; release it before explicit retry`, [...p.actors, e.id]);
  }
}
function beginDrain(ex: Exec, issue?: Diagnostic) { ex.mode = ex.ending ? 'ending' : 'draining'; ex.error = issue; }
function drain(rt: Runtime, ex: Exec): StepResult {
  for (const id of ex.children) if (rt.records.get(id)?.parent === ex.id && rt.isActive(id)) rt.cancel(id);
  if (ex.children.some(id => rt.isActive(id))) return { status: 'running', phase: ex.ending ? 'ending' : 'draining' };
  ex.current = [];
  if (ex.ending) { ex.mode = 'completed'; return { status: 'completed', outputs: { ended: true, arrived: false } }; }
  ex.mode = ex.error ? 'waiting' : 'paused';
  return ex.error ? { status: 'blocked', diagnostic: ex.error } : { status: 'running', phase: 'paused' };
}
function dispatch(rt: Runtime, ex: Exec, targets: [Vec2, Vec2]) {
  ex.current = []; ex.stationaryTicks = 0; ex.last = ex.p.actors.map(a => point(rt, a)) as [Vec2, Vec2];
  for (let i = 0; i < 2; i++) {
    const rec = rt.submit('walk_to', { actor: ex.p.actors[i], x: targets[i][0], z: targets[i][1], level: 0, speed: ex.p.speed, face: heading(routeVector(ex.p)) }, { parent: ex.id, preempt: false });
    ex.children.push(rec.id); ex.current.push(rec.id);
    if (rec.status === 'failed') { beginDrain(ex, diag('child', `${ex.p.actors[i]}'s owned walk refused: ${rec.diagnostic?.message}`, [ex.p.actors[i], rec.id], rec.diagnostic)); break; }
  }
}
const id = z.string().min(1).max(80), xz = z.tuple([z.number().min(-500).max(500), z.number().min(-500).max(500)]);
export const pairedWalk: ActionDef<PairedWalkParams, null, Exec> = {
  verb: 'paired_walk', description: 'Invite an explicit free-handed pair to regroup and walk at equal speed along one authored clear ground corridor; explicit retry after separation.',
  schema: z.strictObject({ actors: z.tuple([id, id]), rendezvous: z.tuple([xz, xz]), destination: z.tuple([xz, xz]), speed: z.number().min(0.3).max(1.0).default(0.9) }),
  reservations: (_world, p) => p.actors.map(actor => ({ resource: `paired-walk:${actor}`, mode: 'exclusive' as const })),
  plan(rt, p) {
    if (p.actors[0] === p.actors[1]) return { ok: false, diagnostic: diag('duplicate', `${p.actors[0]} cannot accompany itself`, [...p.actors]) };
    const issue = readyIssue(rt, p) ?? geometryIssue(rt, p, p.rendezvous);
    return issue ? { ok: false, diagnostic: issue } : { ok: true, program: null };
  },
  start(rt, p, _program, action) {
    const ex: Exec = { id: action, p: structuredClone(p), mode: 'regrouping', children: [], current: [], regroup: structuredClone(p.rendezvous), traveled: false, ending: false, last: p.actors.map(a => point(rt, a)) as [Vec2, Vec2], stationaryTicks: 0 };
    ((rt.services.pairedWalks ??= {}) as Store)[action] = ex; return ex;
  },
  onDirective(_rt, ex, by, claims, ancestors) {
    if (!['regrouping', 'walking'].includes(ex.mode) || ancestors.includes(ex.id) || by.verb === 'paired_walk_control') return;
    if (claims.some(c => ex.p.actors.some(a => c.resource === `actor:${a}`)))
      beginDrain(ex, diag('directed-away', `${by.verb} ${by.id} takes priority; the pair waits for explicit regroup`, [by.id, ...ex.p.actors]));
  },
  yieldTo(rt, self, holder) { return lookup(rt, self.id)?.children.includes(holder.id) ? [holder.id] : []; },
  step(rt, ex) {
    if (ex.mode === 'ending' || ex.mode === 'draining') return drain(rt, ex);
    if (ex.mode === 'waiting' || ex.mode === 'paused') return ex.error ? { status: 'blocked', diagnostic: ex.error } : { status: 'running', phase: 'paused' };
    if (!ex.current.length) {
      const issue = readyIssue(rt, ex.p) ?? geometryIssue(rt, ex.p, ex.regroup);
      if (issue) { beginDrain(ex, issue); return drain(rt, ex); }
      dispatch(rt, ex, ex.mode === 'regrouping' ? ex.regroup : ex.p.destination);
      return ex.error ? drain(rt, ex) : { status: 'running', phase: ex.mode };
    }
    const records = ex.current.map(id => rt.records.get(id)!);
    // Regroup is ordinary independent walking: a transient person wait belongs
    // to the existing walker recovery, bounded by the unchanged progress clock.
    const regroupWait = records.find(r => ex.mode === 'regrouping' && r.parent === ex.id && r.verb === 'walk_to' && r.status === 'blocked' && r.diagnostic?.code === 'traffic.person');
    const bad = records.find(r => ['failed', 'cancelled', 'blocked'].includes(r.status) && !(ex.mode === 'regrouping' && r.parent === ex.id && r.verb === 'walk_to' && r.status === 'blocked' && r.diagnostic?.code === 'traffic.person'));
    if (bad) { beginDrain(ex, diag('child-stopped', `${bad.id} cannot continue the pair: ${bad.diagnostic?.message ?? bad.status}`, [bad.id, ...ex.p.actors], bad.diagnostic)); return drain(rt, ex); }
    if (ex.mode === 'walking' && dist2(point(rt, ex.p.actors[0]), point(rt, ex.p.actors[1])) > PAIR_MAX_SEPARATION) {
      beginDrain(ex, diag('separated', `${ex.p.actors.join(' and ')} separated beyond ${PAIR_MAX_SEPARATION} m; Resume regroups from actual positions`, [...ex.p.actors])); return drain(rt, ex);
    }
    const now = ex.p.actors.map(a => point(rt, a)) as [Vec2, Vec2];
    if (now.some((p, i) => dist2(p, ex.last[i]) > 0.01)) { ex.last = now; ex.stationaryTicks = 0; }
    else ex.stationaryTicks++;
    if (ex.stationaryTicks > PAIR_STALL_TICKS) { beginDrain(ex, diag('stalled', `${ex.p.actors.join(' and ')} made no physical progress for ${PAIR_STALL_TICKS} ticks`, [...ex.p.actors])); return drain(rt, ex); }
    if (regroupWait) return { status: 'blocked', diagnostic: diag('regroup-traffic', `Regroup waits through ordinary walker recovery: ${regroupWait.diagnostic!.message}`, [regroupWait.id, ...ex.p.actors], regroupWait.diagnostic) };
    if (records.every(r => r.status === 'completed')) {
      const targets = ex.mode === 'regrouping' ? ex.regroup : ex.p.destination;
      if (now.some((p, i) => dist2(p, targets[i]) > EPS)) { beginDrain(ex, diag('arrival', 'Owned walks ended away from their committed pair positions', [...ex.p.actors])); return drain(rt, ex); }
      ex.current = [];
      if (ex.mode === 'walking') { ex.mode = 'completed'; return { status: 'completed', outputs: { arrived: true, destination: structuredClone(ex.p.destination) } }; }
      ex.mode = 'walking'; ex.traveled = true;
    }
    return { status: 'running', phase: ex.mode };
  },
  cancel(rt, ex) {
    ex.ending = true; beginDrain(ex);
    const result = drain(rt, ex);
    return result.status === 'completed' ? { ok: true } : { ok: true, deferred: true };
  },
  resumable: 'Paired walking requires explicit runtime-local Pause/Resume; active snapshot restoration is outside this bounded interaction.',
};
export const pairedWalkControl: ActionDef<PairedWalkControlParams, null, null> = {
  verb: 'paired_walk_control', description: 'Pause, explicitly regroup/resume, or terminally end one bound paired walk.',
  schema: z.strictObject({ walk: id, intent: z.enum(['pause', 'resume', 'end']) }), reservations: () => [],
  plan(rt, p) {
    const ex = lookup(rt, p.walk);
    if (!ex || !rt.isActive(ex.id) || ex.ending) return { ok: false, diagnostic: diag('inactive', `${p.walk} cannot accept ${p.intent}`, [p.walk]) };
    if (p.intent === 'resume') {
      if (!['paused', 'waiting'].includes(ex.mode)) return { ok: false, diagnostic: diag('not-paused', `${p.walk} must finish owned cleanup before Resume`, [p.walk]) };
      const issue = readyIssue(rt, ex.p) ?? geometryIssue(rt, ex.p, regroupPoints(rt, ex));
      if (issue) return { ok: false, diagnostic: issue };
    }
    return { ok: true, program: null };
  },
  start(rt, p) {
    const ex = lookup(rt, p.walk)!;
    if (p.intent === 'end') rt.cancel(ex.id);
    else if (p.intent === 'pause') beginDrain(ex);
    else { ex.regroup = regroupPoints(rt, ex); ex.mode = 'regrouping'; ex.error = undefined; ex.current = []; }
    return null;
  },
  step: () => ({ status: 'completed' }), cancel: () => ({ ok: true }), resumable: true,
};
export function readPairedWalk(rt: Runtime, action: string): PairedWalkReadout | undefined {
  const ex = lookup(rt, action), rec = rt.records.get(action); if (!ex || !rec) return;
  // Later independent movement cannot undo this action's certified joint arrival.
  const arrived = rec.status === 'completed' && ex.mode === 'completed' && !ex.ending;
  const issue = ex.error ?? (ex.mode === 'regrouping' && rec.status === 'blocked' ? rec.diagnostic : undefined);
  return { action, status: rec.status, mode: ex.mode, bindings: structuredClone(ex.p), regroup: structuredClone(ex.regroup), ownedActions: [...ex.children],
    separation: dist2(point(rt, ex.p.actors[0]), point(rt, ex.p.actors[1])),
    participants: ex.p.actors.map((actor, i) => ({ actor, progress: arrived ? len2(routeVector(ex.p)) : progress(rt, ex.p, i), arrived })),
    ...(issue ? { diagnostic: structuredClone(issue), waitingReason: issue.message } : {}) };
}
export const PAIRED_WALK_ACTIONS: ActionDef[] = [pairedWalk, pairedWalkControl];
