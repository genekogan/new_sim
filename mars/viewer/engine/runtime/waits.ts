// Mover-level wait publication. This is runtime service state, never physical WorldState.
// A carry's gathering walkers share an action id but remain distinct graph vertices.
import type { Diagnostic, StepResult } from '../actions/types.ts';
import type { Runtime } from './runtime.ts';

/** Ten seconds without a changed dependency or pose, after the existing 3–6s local recovery windows. */
export const DEADLOCK_TICKS = 200;
type Wait = { mover: string; owner: string; aliases: string[]; blockers: string[]; code: string; tick: number; signature: string; since: number };
type Episode = { since: number; signature: string };
type WaitState = { samples: Map<string, Wait>; episodes: Map<string, Episode> };
const SLOT = 'moverWaits';

export function publishWait(rt: Runtime, owner: string, mover: string, blockers: string[], diagnostic: Diagnostic, aliases: string[] = []) {
  const state: WaitState = rt.services[SLOT] ??= { samples: new Map(), episodes: new Map() };
  const names = [...new Set([mover, ...aliases])].sort();
  const dependencies = [...new Set(blockers)].filter((id) => !names.includes(id)).sort();
  if (!dependencies.length) return;
  const signature = JSON.stringify([owner, names, dependencies, diagnostic.code, rt.world.entities[mover]?.pose]);
  const prior = state.samples.get(mover);
  state.samples.set(mover, { mover, owner, aliases: names, blockers: dependencies, code: diagnostic.code, tick: rt.tick, signature,
    since: prior?.signature === signature && prior.tick >= rt.tick - 1 ? prior.since : rt.tick });
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
  const assigned = new Set<string>(), episodes = new Map<string, Episode>();
  for (const id of nodes) {
    if (assigned.has(id)) continue;
    const members = nodes.filter((other) => reach.get(id)!.has(other) && reach.get(other)!.has(id));
    for (const member of members) assigned.add(member);
    if (members.length < 2) continue;
    const key = JSON.stringify(members);
    const samples = members.map((member) => state.samples.get(member)!);
    const signature = JSON.stringify(samples.map((s) => [s.signature, s.since, edges.get(s.mover)]));
    const previous = state.episodes.get(key);
    const episode = previous?.signature === signature ? previous : { since: rt.tick, signature };
    episodes.set(key, episode);
    if (rt.tick - episode.since + 1 < DEADLOCK_TICKS) continue;
    const diagnostic: Diagnostic = { code: 'deadlock.cycle', message: `persistent wait cycle: ${members.join(', ')}; movement remains blocked pending recovery`, subjects: members,
      details: { sinceTick: episode.since, thresholdTicks: DEADLOCK_TICKS, movers: samples.map((s) => ({ mover: s.mover, action: s.owner, blockedBy: s.blockers, code: s.code })),
        edges: members.flatMap((from) => edges.get(from)!.filter((to) => members.includes(to)).map((to) => ({ from, to }))), recovery: 'existing movement retries remain active; no resources released' } };
    for (const s of samples) if (!result.has(s.owner)) result.set(s.owner, diagnostic);
  }
  state.episodes = episodes;
  return result;
}
