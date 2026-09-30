// Authored commitments after one gathering. Logical intent never owns physics.
import { z } from 'zod';
import type { ActionDef, ActionStatus, Diagnostic, StepResult } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Vec2 } from '../core/math.ts';
import { readClassroom } from './classroom.ts';
import { readPurposefulRoutine } from './purposeful-routine.ts';
import { readWorkstation } from '../objects/workstation.ts';
import { slotById } from '../social/slots.ts';
import { createTurns, stepTurns } from './turns.ts';
import type { TurnState } from './turns.ts';

export interface WorkContinuationBinding {
  kind: 'work'; actor: string;
  work: { station: string; seat: string; task: string; duration: number };
  prerequisite: { routine: string; actor: string; station: string; task: string; duration: number };
}
export interface DiscussionContinuationBinding {
  kind: 'discussion'; actors: [string, string]; at: Vec2; duration: number;
}
export interface GatheringContinuationParams { session: string; binding: WorkContinuationBinding | DiscussionContinuationBinding }
export interface GatheringContinuationControlParams { continuation: string; intent: 'pause' | 'resume' | 'end' }
export type GatheringContinuationMode = 'awaiting' | 'running' | 'draining' | 'paused' | 'waiting' | 'ending' | 'completed';
export interface GatheringContinuationReadout {
  action: string; status: ActionStatus; mode: GatheringContinuationMode; phase: string;
  bindings: GatheringContinuationParams; elapsed: number; duration: number; remaining: number;
  child?: string; ownedActions: string[]; waitingReason?: string; diagnostic?: Diagnostic;
  floorHolder?: string; attentionTarget?: { actor: string; point: Vec2 };
}
type Exec = {
  id: string; p: GatheringContinuationParams; mode: GatheringContinuationMode;
  elapsed: number; children: string[]; child?: string; error?: Diagnostic; gate?: Diagnostic;
  workStarted: boolean; ending: boolean; turns: TurnState;
};
type Store = Record<string, Exec>;
const store = (rt: Runtime): Store => (rt.services.gatheringContinuations ??= {});
const lookup = (rt: Runtime, id: string): Exec | undefined => (rt.services.gatheringContinuations as Store | undefined)?.[id];
const actors = (p: GatheringContinuationParams) => p.binding.kind === 'work' ? [p.binding.actor] : p.binding.actors;
const duration = (p: GatheringContinuationParams) => p.binding.kind === 'work' ? p.binding.work.duration : p.binding.duration;
const diagnostic = (code: string, message: string, subjects: string[], cause?: Diagnostic): Diagnostic => ({
  code: `continuation.${code}`, message, subjects, ...(cause ? { details: { cause } } : {}),
});
function identityIssue(rt: Runtime, p: GatheringContinuationParams): Diagnostic | undefined {
  const rec = rt.records.get(p.session), session = readClassroom(rt, p.session);
  if (rec?.verb !== 'classroom_session' || !session)
    return diagnostic('session', `${p.session} is not the committed classroom`, [p.session]);
  for (const actor of actors(p)) {
    if (!rt.world.entities[actor]?.human || !session.participants.some(q => q.actor === actor))
      return diagnostic('participant', `${actor} is not a person in ${p.session}`, [actor, p.session]);
  }
  if (p.binding.kind === 'discussion') {
    if (p.binding.actors[0] === p.binding.actors[1]) return diagnostic('duplicate-actor', `${p.binding.actors[0]} cannot discuss with itself`, [...p.binding.actors]);
    return;
  }
  const b = p.binding, prior = readPurposefulRoutine(rt, b.prerequisite.routine);
  if (!prior || prior.bindings.session !== p.session || prior.bindings.actor !== b.prerequisite.actor ||
      prior.bindings.work.station !== b.prerequisite.station || prior.bindings.work.task !== b.prerequisite.task || prior.bindings.work.duration !== b.prerequisite.duration)
    return diagnostic('prerequisite-binding', `${b.prerequisite.routine} must retain ${b.prerequisite.actor}'s exact ${b.prerequisite.task} at ${b.prerequisite.station} for ${p.session}`, [b.prerequisite.routine, b.prerequisite.actor, b.prerequisite.station, p.session]);
  const work = readWorkstation(rt, b.work.station);
  if ('code' in work) return diagnostic('workstation', work.message, [b.work.station], work);
  const seat = slotById(rt, b.work.seat);
  if ('code' in seat || seat.kind !== 'seat') return diagnostic('seat', `${b.work.seat} must be a real seat`, [b.work.seat], 'code' in seat ? seat : undefined);
}
function readyIssue(rt: Runtime, p: GatheringContinuationParams): Diagnostic | undefined {
  for (const actor of actors(p)) {
    const e = rt.world.entities[actor], holders = rt.holder(`actor:${actor}`);
    if (!e?.human || e.human.level !== 0 || Math.abs(e.pose.p[1]) > 0.01 || e.human.activity !== 'idle' || holders.length)
      return diagnostic('actor-busy', `${actor} must be physically free on the ground; held by ${holders.join(', ') || e?.human?.activity || 'missing'}`, [actor, ...holders]);
  }
}
function gateIssue(rt: Runtime, ex: Exec): { issue?: Diagnostic; terminal?: boolean } {
  const session = rt.records.get(ex.p.session);
  if (!session || ['failed', 'cancelled'].includes(session.status))
    return { issue: diagnostic('session-ended', `${ex.p.session} did not complete ordinary departure`, [ex.p.session], session?.diagnostic), terminal: true };
  if (session.status !== 'completed')
    return { issue: diagnostic('await-departure', `Wait for ${ex.p.session}'s ordinary physical departure`, [ex.p.session]) };
  if (ex.p.binding.kind === 'work') {
    const b = ex.p.binding, prior = readPurposefulRoutine(rt, b.prerequisite.routine);
    if (!prior || ['cancelled', 'failed'].includes(prior.status) || (prior.status === 'completed' && prior.progress.workElapsed < b.prerequisite.duration - 1e-9))
      return { issue: diagnostic('prerequisite-ended', `${b.prerequisite.routine} did not finish ${b.prerequisite.actor}'s bound ${b.prerequisite.task}`, [b.prerequisite.routine, b.prerequisite.actor]), terminal: true };
    if (prior.status !== 'completed')
      return { issue: diagnostic('await-notes', `Wait for ${b.prerequisite.routine} to finish ${b.prerequisite.actor}'s ${b.prerequisite.task}`, [b.prerequisite.routine, b.prerequisite.actor]) };
  }
  return {};
}
function lastExecutedWork(rt: Runtime, station: string): string | undefined {
  let action: string | undefined, tick = -1;
  for (const rec of rt.records.values()) {
    if (rec.verb !== 'work_at' || (rec.params as { station?: string }).station !== station) continue;
    const started = rec.history.find(h => h.status === 'executing');
    if (started && started.tick >= tick) { action = rec.id; tick = started.tick; }
  }
  return action;
}
function ownWork(rt: Runtime, ex: Exec) {
  if (ex.p.binding.kind !== 'work') return;
  const b = ex.p.binding, w = readWorkstation(rt, b.work.station);
  // work_at clears equipment.action on safe stop; the last executed record retains lineage.
  if (!('code' in w) && w.user === b.actor && w.task === b.work.task && w.duration === b.work.duration && w.seat === b.work.seat && !!ex.child &&
      (w.action === ex.child || (!w.action && lastExecutedWork(rt, b.work.station) === ex.child))) {
    ex.workStarted = true; ex.elapsed = w.elapsed;
  }
}
function formed(rt: Runtime, ex: Exec) {
  return ex.p.binding.kind === 'discussion' && !!ex.child && rt.isActive(ex.child) && rt.records.get(ex.child)?.phase === 'talking' &&
    ex.p.binding.actors.every(a => rt.world.entities[a]?.human?.task === ex.child && rt.world.entities[a]?.human?.activity === 'talk');
}
function beginDrain(ex: Exec, end: boolean, issue?: Diagnostic) {
  ex.ending ||= end; ex.mode = ex.ending ? 'ending' : 'draining'; ex.error = issue ?? ex.error;
  stepTurns(ex.turns, [], false, 0);
}
function wait(ex: Exec, issue: Diagnostic): StepResult {
  ex.mode = 'waiting'; ex.error = issue; ex.gate = undefined;
  return { status: 'blocked', diagnostic: issue };
}
function drain(rt: Runtime, ex: Exec): StepResult {
  for (const id of ex.children) if (rt.isActive(id)) rt.cancel(id);
  ownWork(rt, ex);
  if (ex.children.some(id => rt.isActive(id))) return { status: 'running', phase: ex.ending ? 'ending' : 'draining' };
  ex.child = undefined; ex.gate = undefined;
  if (ex.ending) { ex.mode = 'completed'; return { status: 'completed', outputs: { ended: true } }; }
  ex.mode = ex.error ? 'waiting' : 'paused';
  return ex.error ? { status: 'blocked', diagnostic: ex.error } : { status: 'running', phase: 'paused' };
}
function workCheckpoint(rt: Runtime, ex: Exec): Diagnostic | undefined {
  if (ex.p.binding.kind !== 'work' || !ex.workStarted) return;
  const b = ex.p.binding, w = readWorkstation(rt, b.work.station);
  if ('code' in w || w.user !== b.actor || w.task !== b.work.task || w.duration !== b.work.duration || w.seat !== b.work.seat ||
      (w.action ? !ex.children.includes(w.action) : !ex.children.includes(lastExecutedWork(rt, b.work.station) ?? '')) ||
      Math.abs(w.elapsed - ex.elapsed) > 1e-9 || !['unfinished', 'completed'].includes(w.status))
    return diagnostic('work-changed', `${b.work.station} no longer retains ${b.actor}'s owned ${b.work.task} (${ex.elapsed}s of ${b.work.duration}s)`, [b.work.station, b.actor]);
}
const id = z.string().min(1).max(160), seconds = z.number().positive().max(3600);
export const gatheringContinuation: ActionDef<GatheringContinuationParams, null, Exec> = {
  verb: 'gathering_continuation', description: 'One stable work or pair-discussion commitment after a bound gathering; physical children own all movement.',
  schema: z.strictObject({ session: id, binding: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('work'), actor: id, work: z.strictObject({ station: id, seat: id, task: id, duration: seconds }),
      prerequisite: z.strictObject({ routine: id, actor: id, station: id, task: id, duration: seconds }) }),
    z.strictObject({ kind: z.literal('discussion'), actors: z.tuple([id, id]), at: z.tuple([z.number(), z.number()]), duration: seconds }),
  ]) }),
  reservations: (_world, p) => actors(p).map(actor => ({ resource: `routine:${actor}`, mode: 'exclusive' as const })),
  plan(rt, p) { const issue = identityIssue(rt, p); return issue ? { ok: false, diagnostic: issue } : { ok: true, program: null }; },
  start(rt, p, _program, action) {
    const ex: Exec = { id: action, p: structuredClone(p), mode: 'awaiting', elapsed: 0, children: [], workStarted: false, ending: false, turns: createTurns(0) };
    store(rt)[action] = ex; return ex;
  },
  onDirective(rt, ex, by, claims, ancestors) {
    if (!['awaiting', 'running'].includes(ex.mode) || ancestors.includes(ex.id) || ancestors.includes(ex.p.session) || by.verb === 'gathering_continuation_control') return;
    const params = by.params as { actor?: string; intent?: { actor?: string } }, people = actors(ex.p);
    if (claims.some(c => people.some(a => c.resource === `actor:${a}`)) || people.includes(params.actor ?? params.intent?.actor ?? '')) {
      ownWork(rt, ex);
      beginDrain(ex, false, diagnostic('directed-away', `${by.verb} ${by.id} takes priority over ${ex.id}; explicit resume required`, [by.id, ex.id, ...people]));
    }
  },
  step(rt, ex, dt) {
    ownWork(rt, ex);
    if (ex.mode === 'draining' || ex.mode === 'ending') return drain(rt, ex);
    if (ex.mode === 'paused' || ex.mode === 'waiting') return ex.error ? { status: 'blocked', diagnostic: ex.error } : { status: 'running', phase: 'paused' };
    if (ex.child) {
      const child = rt.records.get(ex.child)!;
      if (formed(rt, ex)) {
        ex.elapsed = Math.min(duration(ex.p), ex.elapsed + dt);
        if (stepTurns(ex.turns, actors(ex.p), true, dt)) rt.mark('continuation.discussion-floor', { continuation: ex.id, group: child.id, floorHolder: ex.turns.floorHolder });
        if (ex.elapsed >= duration(ex.p)) { rt.cancel(child.id); ex.child = undefined; ex.mode = 'completed'; return { status: 'completed', outputs: { talkedSeconds: ex.elapsed } }; }
      }
      if (rt.isActive(child.id)) return child.status === 'blocked' && child.diagnostic
        ? { status: 'blocked', diagnostic: diagnostic('child-wait', child.diagnostic.message, [ex.id, child.id], child.diagnostic) }
        : { status: 'running', phase: child.phase ?? 'arriving' };
      ex.child = undefined;
      if (child.status === 'completed' && ex.p.binding.kind === 'work' && ex.elapsed >= duration(ex.p) - 1e-9) {
        ex.mode = 'completed'; return { status: 'completed', outputs: { task: ex.p.binding.work.task, workedSeconds: ex.elapsed } };
      }
      beginDrain(ex, false, diagnostic('child-stopped', `${child.verb} ${child.id} ended ${child.status} before ${ex.id} finished`, [child.id, ex.id], child.diagnostic));
      return drain(rt, ex);
    }
    const identity = identityIssue(rt, ex.p); if (identity) return wait(ex, identity);
    const gate = gateIssue(rt, ex);
    if (gate.issue) {
      if (gate.terminal) return wait(ex, gate.issue);
      ex.mode = 'awaiting'; ex.gate = gate.issue; return { status: 'running', phase: gate.issue.code === 'continuation.await-departure' ? 'await-departure' : 'await-notes' };
    }
    ex.gate = undefined;
    const issue = readyIssue(rt, ex.p) ?? workCheckpoint(rt, ex); if (issue) return wait(ex, issue);
    if (ex.workStarted && ex.elapsed >= duration(ex.p) - 1e-9) { ex.mode = 'completed'; return { status: 'completed' }; }
    const b = ex.p.binding;
    const child = b.kind === 'work'
      ? rt.submit('work_at', { actor: b.actor, ...b.work, ...(ex.workStarted ? { resume: true } : {}) }, { parent: ex.id, preempt: false })
      : rt.submit('converse', { actors: [...b.actors], at: [...b.at] }, { parent: ex.id, preempt: false });
    ex.children.push(child.id); ex.child = child.id; ex.mode = 'running';
    if (child.status === 'failed') { beginDrain(ex, false, diagnostic('child-refused', `${child.verb} ${child.id} refused ${ex.id}: ${child.diagnostic?.message}`, [ex.id, child.id], child.diagnostic)); return drain(rt, ex); }
    return { status: 'running', phase: b.kind === 'work' ? 'work-arriving' : 'discussion-forming' };
  },
  cancel(rt, ex) { ownWork(rt, ex); beginDrain(ex, true); return { ok: true, deferred: true }; },
  resumable: 'Live continuation pause is supported; active snapshot persistence remains outside this bounded slice.',
};
export const gatheringContinuationControl: ActionDef<GatheringContinuationControlParams, null, null> = {
  verb: 'gathering_continuation_control', description: 'Pause, explicitly resume/retry, or terminally end one local after-gathering commitment.',
  schema: z.strictObject({ continuation: id, intent: z.enum(['pause', 'resume', 'end']) }), reservations: () => [],
  plan(rt, p) {
    const ex = lookup(rt, p.continuation);
    if (!ex || !rt.isActive(p.continuation) || ex.ending) return { ok: false, diagnostic: diagnostic('inactive', `${p.continuation} cannot accept ${p.intent}`, [p.continuation]) };
    if (p.intent === 'resume') {
      if (!['paused', 'waiting'].includes(ex.mode)) return { ok: false, diagnostic: diagnostic('not-paused', `${p.continuation} must finish cleanup before resume`, [p.continuation]) };
      const issue = identityIssue(rt, ex.p) ?? readyIssue(rt, ex.p) ?? workCheckpoint(rt, ex);
      if (issue) return { ok: false, diagnostic: issue };
      const gate = gateIssue(rt, ex); if (gate.terminal) return { ok: false, diagnostic: gate.issue! };
    }
    return { ok: true, program: null };
  },
  start(rt, p) {
    const ex = lookup(rt, p.continuation)!;
    if (p.intent === 'end') rt.cancel(ex.id);
    else if (p.intent === 'pause') { ownWork(rt, ex); beginDrain(ex, false); }
    else { ex.mode = 'awaiting'; ex.error = undefined; ex.gate = undefined; }
    return null;
  },
  step: () => ({ status: 'completed' }), cancel: () => ({ ok: true }), resumable: true,
};
export function readGatheringContinuation(rt: Runtime, action: string): GatheringContinuationReadout | undefined {
  const ex = lookup(rt, action), rec = rt.records.get(action); if (!ex || !rec) return;
  const issue = ex.error ?? ex.gate, floor = ex.mode === 'running' && formed(rt, ex) ? ex.turns.floorHolder : undefined;
  const person = floor ? rt.world.entities[floor] : undefined;
  return { action, status: rec.status, mode: ex.mode, phase: rec.phase ?? ex.mode, bindings: structuredClone(ex.p),
    elapsed: ex.elapsed, duration: duration(ex.p), remaining: Math.max(0, duration(ex.p) - ex.elapsed), child: ex.child, ownedActions: [...ex.children],
    ...(issue ? { diagnostic: structuredClone(issue), waitingReason: issue.message } : {}),
    ...(person ? { floorHolder: floor, attentionTarget: { actor: person.id, point: [person.pose.p[0], person.pose.p[2]] as Vec2 } } : {}) };
}
export const GATHERING_CONTINUATION_ACTIONS: ActionDef[] = [gatheringContinuation, gatheringContinuationControl];
