// Mover-level wait publication. This is runtime service state, never physical WorldState.
// A carry's gathering walkers share an action id but remain distinct graph vertices.
import type { Diagnostic, StepResult, WaitRecoveryResult } from '../actions/types.ts';
import { angleDelta } from '../core/math.ts';
import type { Pose } from '../world/types.ts';
import type { Runtime } from './runtime.ts';

/** Ten seconds without a changed dependency or pose, after the existing 3–6s local recovery windows. */
export const DEADLOCK_TICKS = 200;
type Recovery = WaitRecoveryResult & { requestedTick: number; completedTick?: number };
type Wait = { mover: string; owner: string; aliases: string[]; blockers: string[]; code: string; tick: number; signature: string; identity?: string; anchors?: Record<string, Pose | null>; since: number; recovery?: Recovery };
type Episode = { since: number; signature: string };
type WaitState = { samples: Map<string, Wait>; episodes: Map<string, Episode> };
const SLOT = 'moverWaits';
/** Reporting progress floor: do not mistake bounded sub-millimetre steering jitter for an escape. */
const PROGRESS_EPS = 0.001;
function samePose(a: Pose | null, b: Pose | null) {
  if (!a || !b) return a === b;
  return a.p.reduce((sum, value, i) => sum + (value - b.p[i]) * (value - b.p[i]), 0) <= PROGRESS_EPS * PROGRESS_EPS &&
    Math.abs(angleDelta(a.yaw, b.yaw)) <= PROGRESS_EPS && Math.abs(angleDelta(a.pitch ?? 0, b.pitch ?? 0)) <= PROGRESS_EPS && Math.abs(angleDelta(a.roll ?? 0, b.roll ?? 0)) <= PROGRESS_EPS;
}

export function publishWait(rt: Runtime, owner: string, mover: string, blockers: string[], diagnostic: Diagnostic, aliases: string[] = []) {
  const state: WaitState = rt.services[SLOT] ??= { samples: new Map(), episodes: new Map() };
  const names = [...new Set([mover, ...aliases])].sort();
  const dependencies = [...new Set(blockers)].filter((id) => !names.includes(id)).sort();
  if (!dependencies.length) return;
  const identity = JSON.stringify([owner, names, dependencies]);
  const ids = [...new Set([...names, ...dependencies])].sort();
  const poses: Record<string, Pose | null> = Object.fromEntries(ids.map((id) => {
    const pose = rt.world.entities[id]?.pose;
    return [id, pose ? { ...pose, p: [...pose.p] } : null];
  }));
  const prior = state.samples.get(mover);
  const same = prior?.identity === identity && prior.tick >= rt.tick - 1 && !!prior.anchors && ids.every((id) => samePose(prior.anchors![id], poses[id]));
  const anchors = same ? prior.anchors! : poses;
  const signature = same ? prior.signature : JSON.stringify([identity, anchors]);
  state.samples.set(mover, { mover, owner, aliases: names, blockers: dependencies, code: diagnostic.code, tick: rt.tick, signature, identity, anchors,
    since: same ? prior.since : rt.tick, ...(same && prior.recovery ? { recovery: prior.recovery } : {}) });
}

/** Called at explicit blocking branches: blockers are identities, never parsed diagnostic prose. */
export function blockedWait(rt: Runtime, owner: string, mover: string, blockers: string[], diagnostic: Diagnostic, aliases: string[] = []): StepResult {
  publishWait(rt, owner, mover, blockers, diagnostic, aliases);
  return { status: 'blocked', diagnostic };
}

/** Preserve the walker's existing reciprocal-passage recovery under a reporting overlay. */
export function publishedWaitsFor(rt: Runtime, mover: string, blocker: string, code: string): boolean {
  const sample = (rt.services[SLOT] as WaitState | undefined)?.samples.get(mover);
  return !!sample && sample.tick >= rt.tick - 1 && sample.code === code && sample.blockers.includes(blocker);
}

/** Request at most one actual planner attempt per unchanged mover episode. Deferred budget admission is bounded. */
export function recoverPersistentWaits(rt: Runtime, recover: (owner: string, mover: string) => WaitRecoveryResult) {
  const state = rt.services[SLOT] as WaitState | undefined;
  if (!state) return;
  for (const sample of [...state.samples.values()].sort((a, b) => a.mover < b.mover ? -1 : a.mover > b.mover ? 1 : 0)) {
    if (sample.tick !== rt.tick || !rt.isActive(sample.owner) || rt.tick - sample.since + 1 < DEADLOCK_TICKS) continue;
    if (sample.recovery && sample.recovery.status !== 'deferred') continue;
    const requestedTick = sample.recovery?.requestedTick ?? rt.tick;
    const result: WaitRecoveryResult = rt.tick - requestedTick >= DEADLOCK_TICKS
      ? { status: 'unavailable', diagnostic: { code: 'deadlock.recovery-budget', message: 'recovery admission stayed deferred for 200 ticks', subjects: [sample.mover] } }
      : recover(sample.owner, sample.mover);
    sample.recovery = { ...result, requestedTick, ...(result.status !== 'deferred' ? { completedTick: rt.tick } : {}) };
  }
}

function exhausted(rt: Runtime, sample: Wait) {
  return sample.tick === rt.tick && sample.recovery?.completedTick !== undefined && rt.tick - sample.recovery.completedTick >= DEADLOCK_TICKS;
}
export function exhaustedWaitMovers(rt: Runtime): ReadonlySet<string> {
  const state = rt.services[SLOT] as WaitState | undefined;
  return new Set([...(state?.samples.values() ?? [])].filter((sample) => exhausted(rt, sample)).map((sample) => sample.mover));
}
function recoveryDetails(rt: Runtime, samples: Wait[]) {
  return { exhausted: samples.every((s) => exhausted(rt, s)), recovery: samples.map((s) => ({ mover: s.mover, ...(s.recovery ?? { status: 'pending' }) })) };
}

/** End-of-tick coherent graph. A node that moved, stopped waiting, or finished cannot retain an old edge. */
export function deadlockDiagnostics(rt: Runtime): Map<string, Diagnostic> {
  const result = new Map<string, Diagnostic>();
  const state = rt.services[SLOT] as WaitState | undefined;
  if (!state) return result;
  for (const [id, sample] of state.samples) if (sample.tick !== rt.tick || !rt.isActive(sample.owner)) state.samples.delete(id);
  if (!state.samples.size) { delete rt.services[SLOT]; return result; }
  const nodes = [...state.samples.keys()].sort();
  const aliases = new Map<string, string>(), ambiguous = new Set<string>();
  for (const id of nodes) for (const name of state.samples.get(id)!.aliases) {
    if (aliases.has(name) && aliases.get(name) !== id) ambiguous.add(name);
    aliases.set(name, id);
  }
  // An ambiguous alias cannot prove a dependency on either mover.
  for (const name of ambiguous) aliases.delete(name);
  const edges = new Map(nodes.map((id) => [id, [...new Set(state.samples.get(id)!.blockers.map((b) => aliases.get(b)).filter((b): b is string => !!b && b !== id))].sort()]));
  // Deterministic SCCs via mutual reachability. Wait graphs are bounded by live mover count.
  const reachable = (start: string) => {
    const seen = new Set<string>(), pending = [start];
    while (pending.length) {
      const id = pending.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      pending.push(...edges.get(id)!);
    }
    return seen;
  };
  const reach = new Map(nodes.map((id) => [id, reachable(id)]));
  const assigned = new Set<string>(), cyclic = new Set<string>(), episodes = new Map<string, Episode>();
  for (const id of nodes) {
    if (assigned.has(id)) continue;
    const members = nodes.filter((other) => reach.get(id)!.has(other) && reach.get(other)!.has(id));
    for (const member of members) assigned.add(member);
    if (members.length < 2) continue;
    for (const member of members) cyclic.add(member);
    const key = JSON.stringify(members);
    const samples = members.map((member) => state.samples.get(member)!);
    const signature = JSON.stringify(samples.map((s) => [s.signature, s.since, edges.get(s.mover)]));
    const previous = state.episodes.get(key);
    const episode = previous?.signature === signature ? previous : { since: rt.tick, signature };
    episodes.set(key, episode);
    if (rt.tick - episode.since + 1 < DEADLOCK_TICKS) continue;
    const diagnostic: Diagnostic = { code: 'deadlock.cycle', message: `persistent wait cycle: ${members.join(', ')}; movement remains blocked pending recovery`, subjects: members,
      details: { sinceTick: episode.since, thresholdTicks: DEADLOCK_TICKS, movers: samples.map((s) => ({ mover: s.mover, action: s.owner, blockedBy: s.blockers, code: s.code })),
        edges: members.flatMap((from) => edges.get(from)!.filter((to) => members.includes(to)).map((to) => ({ from, to }))), ...recoveryDetails(rt, samples) } };
    for (const s of samples) if (!result.has(s.owner)) result.set(s.owner, diagnostic);
  }
  for (const id of nodes) {
    const sample = state.samples.get(id)!;
    if (cyclic.has(id) || rt.tick - sample.since + 1 < DEADLOCK_TICKS || result.has(sample.owner)) continue;
    result.set(sample.owner, { code: 'deadlock.stalled', message: `${id} has made no progress while waiting for ${sample.blockers.join(', ')}`, subjects: [id, ...sample.blockers],
      details: { sinceTick: sample.since, thresholdTicks: DEADLOCK_TICKS, movers: [{ mover: id, action: sample.owner, blockedBy: sample.blockers, code: sample.code }], ...recoveryDetails(rt, [sample]) } });
  }
  state.episodes = episodes;
  return result;
}
