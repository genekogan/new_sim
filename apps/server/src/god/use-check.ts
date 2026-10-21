// Lane BS1 (BUILDSAFE item 5, 2026-10-21): can a body actually use what a god placed? Every seat is sat on and every berth
// lain on exactly as the sit plan does it (engine useCheckV1: standing approach, the sit/stand slide, joined to the main
// ground both ways, and the seat height for the standard body), and each unusable slot gets one line a god can act on.
// Callers: BS2's commit check (the entities a commit placed or moved) and BS3's fuzz fixture. The walk audit does not call it
// (its V3-walk baseline counts only navTargetsV1).
import type { WorldModel } from '@sim/world-compiler';
import type { UseCheckV1 } from '@sim/engine-mars';

export type UseVerdict = UseCheckV1 & {
  /** One god-readable line, unusable slots only: what cannot be used, why, and where. */
  line?: string;
};
type UseEngine = { useCheckV1(opts?: { of?: string[]; keep?: (at: [number, number]) => boolean; seatTop?: (slot: { id: string; of: string }) => number | undefined }): UseCheckV1[] };

const WHY: Record<string, string> = {
  'use.no-approach': 'there is no room to stand beside it',
  'use.transition-blocked': 'getting on and off it would pass through something solid',
  'use.seat-fit': 'its seat is the wrong height for a body',
  'nav.disconnected': 'where a body stands to use it is cut off from the rest of the world',
  'nav.one-way': 'where a body stands to use it can be reached one way only',
  'nav.no-standing-room': 'where a body stands to use it has no room to stand',
};

/** The baked seat tops (m above the entity's base) of a placed entity, by slot id: the def's baked seat p[1] at the
 *  entity's scale. Engine seat slots carry no height (the catalog adapter keeps only their footprint), so this is where a
 *  seat's height is read. Empty when unknown. Not used for the edge sit capability: 32 of 180 core seat tops are the
 *  model's box top, not the seat (Mars bus seats 1.22 m, bleacher tiers, cab seats, floor cushions), and the engine sits a
 *  body on them; blocking those sits on the baked top would refuse seats Souls use today (Mars-two S10). */
export function seatTopsOf(model: WorldModel, of: string): Map<string, number> {
  const m = new Map<string, number>(), e = model.entities.get(of), def = e && model.resolvedDef(e.def);
  if (e && def) {
    const s = model.worldPose(e).s;
    for (const slot of model.bake(def, e.params ?? {}, e.seed ?? 0, e.shape).slots) if (slot.kind === 'seat') m.set(slot.id, slot.p[1] * s);
  }
  return m;
}

/** Every seat and berth of `ids` (all fixtures when omitted). With the world `model`, seat heights are checked (the def's
 *  baked seat top at the entity's scale) and lines name things by their path. Pure read. */
export function useCheck(engine: UseEngine, ids?: readonly string[], model?: WorldModel): UseVerdict[] {
  const tops = new Map<string, Map<string, number>>();
  const seatTop = model ? ({ id, of }: { id: string; of: string }) => {
    let m = tops.get(of);
    if (!m) { m = seatTopsOf(model, of); tops.set(of, m); }
    return m.get(id.slice(id.indexOf('#') + 1));
  } : undefined;
  const name = (of: string) => (model?.entities.has(of) ? model.pathOf(of) : of);
  return engine.useCheckV1({ ...(ids ? { of: [...ids] } : {}), ...(seatTop ? { seatTop } : {}) }).map((v) => {
    if (v.ok) return v;
    const slot = v.id.slice(v.id.indexOf('#') + 1), at = v.at ? ` (at ${v.at[0].toFixed(1)}, ${v.at[1].toFixed(1)})` : '';
    // what is in the way, by path: the engine names obstacles by entity id (`e_…` or `e_…#c0`)
    const inWay = [...new Set([...(v.message ?? '').matchAll(/\b(e_[0-9a-f]{6,})(?:#[\w-]+)?/g)].map((m) => m[1]).filter((e) => e !== v.of))].map(name);
    return { ...v, line: `${name(v.of)} ${slot}: cannot be ${v.kind === 'berth' ? 'lain on' : 'sat on'}: ${WHY[v.code ?? ''] ?? v.code}${at}${inWay.length ? `; in the way: ${inWay.join(', ')}` : ''}.` };
  });
}
