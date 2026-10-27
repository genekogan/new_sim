// Semantic references are canonical entity IDs, independent of physical containment.
import type { About, Failure, WorldAbout } from './schemas.ts';
import type { WorldModel } from './model.ts';
import { stableStringify } from './hash.ts';

export function canonicalAbout(w: WorldModel, about: About, ids: Record<string, string> = {}): About {
  const out = structuredClone(about);
  const ref = (value: string) => w.get(ids[value] ?? value)?.id ?? value;
  if (out.in) out.in = ref(out.in);
  for (const part of out.parts ?? []) if (part.anchor?.kind === 'entity') part.anchor.ref = ref(part.anchor.ref);
  return out;
}
export function canonicalWorldAbout(w: WorldModel, about: WorldAbout, ids: Record<string, string> = {}): WorldAbout {
  return { ...about, ...(about.districts ? { districts: [...new Set(about.districts.map(ref => w.get(ids[ref] ?? ref)?.id ?? ref))] } : {}) };
}
export function remapAbout(about: About | undefined, ids: Map<string, string>): About | undefined {
  if (!about) return undefined;
  const out = structuredClone(about);
  if (out.in) out.in = ids.get(out.in) ?? out.in;
  for (const p of out.parts ?? []) if (p.anchor?.kind === 'entity') p.anchor.ref = ids.get(p.anchor.ref) ?? p.anchor.ref;
  return out;
}
/** Validate the final batch, so references may be cleared in the same batch as a deletion. */
export function meaningFailure(w: WorldModel, op: number): Failure | null {
  const fail = (detail: string): Failure => ({ op, code: 'about.invalid', detail });
  for (const e of w.entities.values()) {
    const a = e.about; if (!a) continue;
    if (a.in && !w.entities.has(a.in)) return fail(`${w.pathOf(e.id)}: semantic parent ${a.in} does not exist`);
    const seen = new Set([e.id]); let ref = a.in;
    while (ref) { if (seen.has(ref)) return fail(`${w.pathOf(e.id)}: semantic parent cycle`); seen.add(ref); ref = w.entities.get(ref)?.about?.in; }
    for (const p of a.parts ?? []) {
      const anchor = p.anchor; if (anchor?.kind !== 'entity') continue;
      const target = w.entities.get(anchor.ref);
      if (!target) return fail(`${w.pathOf(e.id)}/${p.id}: part target ${anchor.ref} does not exist`);
      if (anchor.slot && !w.slotsOf(target).some(s => s.id === anchor.slot && (s.kind === 'room' || s.kind === 'seat')))
        return fail(`${w.pathOf(e.id)}/${p.id}: ${anchor.slot} is not a room or seat of ${w.pathOf(target.id)}`);
    }
  }
  for (const ref of w.state.about?.districts ?? []) if (!w.entities.has(ref)) return fail(`world district ${ref} does not exist`);
  return null;
}
export const sameMeaning = (a: unknown, b: unknown) => stableStringify(a ?? null) === stableStringify(b ?? null);
