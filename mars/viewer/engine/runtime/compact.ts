// A fresh Runtime is safe only after every controller has released its body.
// This intentionally preserves no action history or service store. Durable
// quantities (food, garden care, bookmarks, construction) belong to WorldState.
import { Runtime } from './runtime.ts';
import type { ActionDef } from '../actions/types.ts';
import type { WorldState } from '../world/types.ts';
import type { Invariant, RuntimeServices } from './runtime.ts';

export function compactionIssue(rt: Runtime): string | null {
  for (const r of rt.records.values()) if (rt.isActive(r.id)) return `active action ${r.id} (${r.verb})`;
  if (rt.services.socialReturns?.length) return 'pending social return';
  for (const e of Object.values(rt.world.entities)) {
    if (e.reservedBy || e.human?.task || e.human?.grip) return `unreleased controller on ${e.id}`;
    if (e.phase === 'raising' || e.support?.kind === 'held' || e.support?.kind === 'none') return `unsettled load ${e.id}`;
    if (e.equipment?.config.status === 'active') return `active equipment ${e.id}`;
  }
  return null;
}

export function compactRuntime(rt: Runtime, services: (world: WorldState) => RuntimeServices): Runtime {
  const issue = compactionIssue(rt);
  if (issue) throw new Error(`compaction.not-quiet: ${issue}`);
  const world = structuredClone(rt.world);
  const next = new Runtime(world, rt.registry as Map<string, ActionDef>, services(world), rt.invariants as Invariant[]);
  if (next.stateHash() !== rt.stateHash()) throw new Error('compaction.state-changed');
  return next;
}
