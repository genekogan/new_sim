import type { StepSpec } from './types.ts';
import type { StepReport } from './runner.ts';

/** Pending work cannot release a certified wait if a mandatory completion gate cannot finish.
 * Call only after the runtime certifies every live/internal mover quiescent. This proof changes
 * no reports: tails stay pending and an explicit continuation can still admit them later.
 */
export function completionBlockedTails(steps: readonly StepSpec[], reports: readonly StepReport[], live: ReadonlySet<string>): string[] | null {
  const specs = new Map(steps.map((s) => [s.id, s]));
  const state = new Map(reports.map((r) => [r.id, r]));
  if (specs.size !== steps.length || state.size !== reports.length || specs.size !== state.size) return null;
  for (const s of steps) {
    if (!state.has(s.id)) return null;
    const dependencies = [...(s.after ?? []), ...(s.when ? [s.when.step] : [])];
    if (dependencies.some((id) => id === s.id || !specs.has(id))) return null;
    if (s.when && s.when.event !== 'started' && s.when.event !== 'completed') return null;
  }
  // Invalid dependency cycles are not evidence of physical quiescence.
  const remaining = new Map(steps.map((s) => [s.id, new Set([...(s.after ?? []), ...(s.when ? [s.when.step] : [])])]));
  const ready = steps.filter((s) => remaining.get(s.id)!.size === 0).map((s) => s.id);
  for (let i = 0; i < ready.length; i++) {
    remaining.delete(ready[i]);
    for (const [id, dependencies] of remaining) if (dependencies.delete(ready[i]) && dependencies.size === 0) ready.push(id);
  }
  if (remaining.size) return null;
  const closed = new Set(reports.filter((r) => (r.status === 'executing' || r.status === 'blocked') && r.actionId && live.has(r.actionId)).map((r) => r.id));
  const pending = steps.filter((s) => state.get(s.id)!.status === 'pending');
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of pending) {
      if (closed.has(s.id)) continue;
      const completion = [...(s.after ?? []), ...(s.when?.event === 'completed' ? [s.when.step] : [])];
      // Conditions are conjunctive: even a future time cue cannot bypass this completion gate.
      if (completion.some((id) => closed.has(id))) { closed.add(s.id); changed = true; }
    }
  }
  return pending.every((s) => closed.has(s.id)) ? pending.map((s) => s.id).sort() : null;
}
