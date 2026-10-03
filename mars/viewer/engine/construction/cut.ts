// cut — the cutting station turns stock lengths into the sizes a reconstruction needs (owner feedback
// 2026-09-28 §7: "a 4x8 sheet → the 4x6 the bay uses, a 16 ft 2x4 → 8 ft, with offcuts").
// Mars assembly model v1, approximate.
//
// `cut {actor, station, stock, cuts: [{piece, def}], offcut?}` — one person at a `cutting-station`:
//   * the stock is a stored/staged piece lying on the ground within STOCK_REACH of the station
//     (brought by take_from_bundle + carry); it is not moved onto the bench (abstraction);
//   * targets are the stock's family (same category and cross-section: 2x4 → 2x4, 3/4 in 4 ft plywood
//     → 3/4 in 4 ft plywood; plywood is cut across its length only, no rips);
//   * lengths: Σ targets + KERF per cut ≤ stock length (+5 mm: the last piece may be the stock's end,
//     ≤ 5 mm short). The remainder beyond one more kerf is the offcut: it becomes a `stored` entity at
//     the station when a catalog piece of that family fits it (largest whole size ≤ remainder + 1 cm),
//     else it is waste (reported in the outputs);
//   * timing: the operator walks to the bench front, marks (MARK_S), then per cut handles the stock
//     (HANDLE_S) and saws across the piece at FEED m/s (a 4 ft plywood cut = 6.1 s, a 2x4 0.45 s);
//   * results lie in the station's out-feed slots behind the bench (long axis along the bench, 0.8 m
//     apart so a carrier can stand between them); the
//     stock entity is consumed.
// Refusals: cut.not-station, cut.stock-unknown, cut.stock-not-at-station, cut.wrong-stock (family /
// rip), cut.insufficient (names the lengths), cut.piece-exists, cut.station-occupied (names what lies in
// an out-feed slot; a second cut at the same station is also refused by its `station:` reservation),
// actor.holding, cut.station-unreachable.
import { z } from 'zod';
import { rot2, type Vec2 } from '../core/math.ts';
import type { ActionDef, Diagnostic } from '../actions/types.ts';
import { canonicalEntityOrder, type Runtime } from '../runtime/runtime.ts';
import { entityFootprint } from '../spatial/service.ts';
import type { Entity, Pose } from '../world/types.ts';
import { CATALOG, def, type AssetDef } from '../world/catalog.ts';
import { checkStations, childrenState, walkCrew, type Children } from './children.ts';
import { holdingDiagnostic } from './rules.ts';
import { lyingObb, lyingPose, spotBlocker } from './bundle.ts';
import { CUT_TO_ORDER, NOTCH } from '../world/catalog-phase-b.ts';

export const KERF = 0.003; // m: saw blade
export const FEED = 0.2; // m/s: saw feed across the piece
export const MARK_S = 3; // s: measure and mark
export const HANDLE_S = 3; // s per cut: position, clamp, clear
export const STOCK_REACH = 2.5; // m from the station's footprint to the stock's centre
const OUT_GAP = 0.8; // m: out-feed slot spacing (room for a carrier to stand)
const LEN_TOL = 0.005; // m: a piece is its def's length within 5 mm
const f3 = (x: number) => x.toFixed(3);
const fail = (code: string, message: string, subjects: string[]): { ok: false; diagnostic: Diagnostic } => ({ ok: false, diagnostic: { code, message, subjects } });

/** Same family: category and cross-section (timber: height × thickness; plywood: thickness × width). */
export function sameFamily(a: AssetDef, b: AssetDef): boolean {
  if (a.category !== b.category || (a.category !== 'timber' && a.category !== 'plywood')) return false;
  if (Math.abs(a.size[1] - b.size[1]) < 0.002 && Math.abs(a.size[2] - b.size[2]) < 0.002) return true;
  // a board defined lying flat (phase B stair treads) is the same lumber as the stock defined on edge
  return a.category === 'timber' && Math.abs(a.size[1] - b.size[2]) < 0.002 && Math.abs(a.size[2] - b.size[1]) < 0.002;
}

// Phase B (W13, provisional): a plywood target may also be RIPPED narrower (one saw pass along its length,
// the strip beyond it is waste) — a 15 ft wall closes with a 3 ft panel. Only one target per cut when ripping.
export const RIP_MIN = 0.3; // m: narrowest rip
/** A plywood target of the stock's thickness, narrower than it (≥ RIP_MIN): cut to length, then ripped. */
export function ripFamily(stock: AssetDef, target: AssetDef): boolean {
  return stock.category === 'plywood' && target.category === 'plywood' && Math.abs(stock.size[1] - target.size[1]) < 0.002 && target.size[2] < stock.size[2] - 0.002 && target.size[2] >= RIP_MIN;
}
/** Seconds to notch a piece around a frame (jigsaw, catalog-phase-b.ts NOTCH), per notched target. */
export const NOTCH_S = 30;

/** Largest catalog piece of `stock`'s family no longer than `len` + 1 cm (≥ 0.3 m), or null. Cut-to-order sizes (phase B: notched, Kit stair, wall panels) are never offcuts. */
export function offcutDef(stock: AssetDef, len: number): AssetDef | null {
  const fits = Object.values(CATALOG).filter((d) => sameFamily(d, stock) && d.size[0] >= 0.3 && d.size[0] <= len + 0.01 && d.id !== 'stair-tread' && !CUT_TO_ORDER.has(d.id)).sort((a, b) => b.size[0] - a.size[0] || (a.id < b.id ? -1 : 1));
  return fits[0] ?? null;
}

/** Cut plan of one stock length into targets: remainder / offcut / waste, or why it cannot yield them. */
export function cutPlan(stockDef: string, targets: string[]): { ok: true; cuts: number; rest: number; offcut: AssetDef | null; waste: number } | { ok: false; code: string; message: string } {
  const s = def(stockDef);
  for (const t of targets) {
    const d = CATALOG[t];
    if (!d) return { ok: false, code: 'cut.wrong-stock', message: `unknown target "${t}"` };
    if (!sameFamily(s, d) && !(ripFamily(s, d) && targets.length === 1)) return { ok: false, code: 'cut.wrong-stock', message: `a ${d.label} cannot be cut from a ${s.label} (${s.category === 'plywood' ? (ripFamily(s, d) ? 'a rip is cut on its own: one target per cut' : 'plywood is cut across its length, or ripped to ≥ 0.3 m wide') : 'different section'})` };
  }
  const L = s.size[0];
  const sum = targets.reduce((a, t) => a + def(t).size[0], 0);
  const between = KERF * Math.max(0, targets.length - 1);
  const need = sum + between;
  if (need > L + LEN_TOL)
    return { ok: false, code: 'cut.insufficient', message: `a ${s.label} (${f3(L)} m) cannot yield ${targets.map((t) => def(t).label).join(' + ')} (${f3(sum)} m + ${targets.length - 1} kerf${targets.length === 2 ? '' : 's'} = ${f3(need)} m)` };
  const r = L - need;
  if (r <= KERF + 1e-9) return { ok: true, cuts: Math.max(0, targets.length - 1), rest: 0, offcut: null, waste: Math.max(0, r) };
  const rest = r - KERF; // one more cut frees the last target from the offcut
  const oc = rest >= 0.3 ? offcutDef(s, rest) : null;
  return { ok: true, cuts: targets.length, rest, offcut: oc, waste: oc ? rest - Math.min(rest, oc.size[0]) : rest };
}

type P = { actor: string; station: string; stock: string; cuts: { piece: string; def: string }[]; offcut?: string };
type Slot = { id: string; def: string; pose: Pose };
type Prog = { operator: { p: Vec2; yaw: number }; slots: Slot[]; duration: number; waste: number; rest: number };
type Exec = { p: P; prog: Prog; id: string; phase: 'approach' | 'saw'; t: number; children?: Children };

function planCut(rt: Runtime, p: P): { ok: true; program: Prog } | { ok: false; diagnostic: Diagnostic } {
  const w = rt.world;
  const st = w.entities[p.station];
  if (!st || st.def !== 'cutting-station') return fail('cut.not-station', `"${p.station}" is not a cutting station`, [p.station]);
  const stock = w.entities[p.stock];
  if (!stock || stock.kind !== 'component') return fail('cut.stock-unknown', `no stock piece "${p.stock}"`, [p.stock]);
  if ((stock.phase !== 'stored' && stock.phase !== 'staged') || stock.support?.kind !== 'ground')
    return fail('cut.stock-not-at-station', `${p.stock} is ${stock.phase} (support ${stock.support?.kind}); stock is cut from the ground beside the station`, [p.stock]);
  const sf = entityFootprint(st).obb;
  const l = rot2([stock.pose.p[0] - sf.c[0], stock.pose.p[2] - sf.c[1]], -sf.yaw);
  const gap = Math.max(Math.abs(l[0]) - sf.half[0], Math.abs(l[1]) - sf.half[1], 0);
  if (gap > STOCK_REACH) return fail('cut.stock-not-at-station', `${p.stock} lies ${gap.toFixed(2)} m from ${p.station} (≤ ${STOCK_REACH} m): carry it to the station first`, [p.stock, p.station]);
  const plan = cutPlan(stock.def, p.cuts.map((c) => c.def));
  if (!plan.ok) return fail(plan.code, `${p.stock}: ${plan.message}`, [p.stock]);
  const ids = [...p.cuts.map((c) => c.piece), ...(plan.offcut ? [p.offcut ?? `${p.stock}-offcut`] : [])];
  for (const id of ids) if (w.entities[id] && id !== p.stock) return fail('cut.piece-exists', `an entity "${id}" already exists; cut pieces need new ids`, [id]);
  if (new Set(ids).size !== ids.length) return fail('cut.piece-exists', `cut piece ids repeat: ${ids.join(', ')}`, ids);
  const a = w.entities[p.actor];
  if (a?.kind !== 'human') return fail('entity.unknown', `no person "${p.actor}"`, [p.actor]);
  const hd = holdingDiagnostic(w, p.actor);
  if (hd) return { ok: false, diagnostic: hd };
  // out-feed slots behind the bench (+z local), long axis along the bench
  const sd = def('cutting-station').size, g = st.pose.p[1];
  const slots: Slot[] = [];
  let z0 = sd[2] / 2 + OUT_GAP; // a carrier stands between the bench and a piece, and between pieces
  const defs = [...p.cuts.map((c) => ({ id: c.piece, def: c.def })), ...(plan.offcut ? [{ id: p.offcut ?? `${p.stock}-offcut`, def: plan.offcut.id }] : [])];
  for (const d of defs) {
    const w_ = def(d.def).size[2];
    const c = rot2([0, z0 + w_ / 2], st.pose.yaw);
    const x = st.pose.p[0] + c[0], z = st.pose.p[2] + c[1];
    const blocker = spotBlocker(rt, lyingObb(d.def, x, z, st.pose.yaw), g + def(d.def).size[1] + 0.05, [p.station, p.actor, p.stock]);
    if (blocker) return fail('cut.station-occupied', `the out-feed of ${p.station} is occupied by ${blocker} at (${x.toFixed(2)}, ${z.toFixed(2)}); clear it first`, [p.station, blocker.replace(/^static /, '')]);
    slots.push({ id: d.id, def: d.def, pose: lyingPose(d.def, x, z, st.pose.yaw, g) });
    z0 += w_ + OUT_GAP;
  }
  const o = rot2([0, -(sd[2] / 2 + 0.45)], st.pose.yaw);
  const across = def(stock.def).category === 'plywood' ? def(stock.def).size[2] : def(stock.def).size[1];
  // phase B: a rip is one more pass along the piece; a notch is jigsaw time
  const rips = p.cuts.filter((c) => ripFamily(def(stock.def), def(c.def))).reduce((a, c) => a + HANDLE_S + def(c.def).size[0] / FEED, 0);
  const notches = p.cuts.filter((c) => NOTCH[c.def]).length * NOTCH_S;
  const duration = MARK_S + plan.cuts * (HANDLE_S + across / FEED) + rips + notches;
  return { ok: true, program: { operator: { p: [st.pose.p[0] + o[0], st.pose.p[2] + o[1]], yaw: st.pose.yaw + Math.PI / 2 }, slots, duration, waste: plan.waste, rest: plan.rest } };
}

export const cutStock: ActionDef<P, Prog, Exec> = {
  verb: 'cut',
  description: 'One person at a cutting station cuts a stock piece lying beside it into catalog pieces of its family (plus an offcut stored at the station); refused if the station is busy, the stock is not there, or it cannot yield the sizes.',
  schema: z.strictObject({
    actor: z.string().max(80),
    station: z.string().max(80),
    stock: z.string().max(80),
    cuts: z.array(z.strictObject({ piece: z.string().regex(/^[A-Za-z][\w.:-]{0,79}$/), def: z.string().max(80) })).min(1).max(8),
    offcut: z.string().regex(/^[A-Za-z][\w.:-]{0,79}$/).optional(),
  }),
  reservations: (_w, p) => [{ resource: `actor:${p.actor}`, mode: 'exclusive' }, { resource: `station:${p.station}`, mode: 'exclusive' }, { resource: `entity:${p.stock}`, mode: 'exclusive' }],
  plan(rt, p) {
    const r = planCut(rt, p);
    if (!r.ok) return r;
    const un = checkStations(rt, [{ actor: p.actor, p: r.program.operator.p }]);
    return un ? { ok: false, diagnostic: { ...un, code: 'cut.station-unreachable' } } : r;
  },
  start: (_rt, p, prog, id) => ({ p, prog, id, phase: 'approach', t: 0 }),
  step(rt, ex, dt) {
    const w = rt.world;
    if (ex.phase === 'approach') {
      if (!ex.children) {
        const r = walkCrew(rt, ex.id, [{ actor: ex.p.actor, p: ex.prog.operator.p, yaw: ex.prog.operator.yaw }]);
        if ('code' in r) return { status: 'failed', diagnostic: { ...r, code: 'cut.station-unreachable' } };
        ex.children = r;
      }
      const s = childrenState(ex.children);
      if (s === 'running') return { status: 'running', phase: 'approach' };
      if (s !== 'done') return { status: 'failed', diagnostic: s };
      const again = planCut(rt, ex.p);
      if (!again.ok) return { status: 'blocked', diagnostic: again.diagnostic };
      ex.prog = { ...again.program, operator: ex.prog.operator };
      ex.phase = 'saw';
      ex.t = 0;
      w.entities[ex.p.stock].phase = 'reserved';
      w.entities[ex.p.actor].human!.activity = 'cut';
    }
    ex.t += dt;
    if (ex.t + 1e-9 < ex.prog.duration) return { status: 'running', phase: 'saw' };
    const stock = w.entities[ex.p.stock];
    for (const s of ex.prog.slots)
      w.entities[s.id] = {
        id: s.id, def: s.def, kind: 'component', label: `${def(s.def).label} (cut from ${ex.p.stock})`, pose: s.pose,
        provenance: { ...stock.provenance, note: `cut from ${ex.p.stock} at ${ex.p.station}; ${stock.provenance.note ?? ''}`.trim() }, phase: 'stored', support: { kind: 'ground' },
      } satisfies Entity;
    delete w.entities[ex.p.stock];
    canonicalEntityOrder(w);
    Object.assign(w.entities[ex.p.actor].human!, { activity: 'idle', task: undefined });
    return { status: 'completed', outputs: { pieces: ex.prog.slots.map((s) => s.id), waste: Math.round(ex.prog.waste * 1000) / 1000 } };
  },
  cancel(rt, ex) {
    for (const r of ex.children?.recs ?? []) if (rt.isActive(r.id)) rt.cancel(r.id);
    const s = rt.world.entities[ex.p.stock];
    if (s && s.phase === 'reserved') s.phase = 'stored';
    const h = rt.world.entities[ex.p.actor]?.human;
    if (h && h.activity === 'cut') h.activity = 'idle';
    return { ok: true };
  },
  resumable: true,
};
