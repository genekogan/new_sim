// take_from_bundle — unbundling stock from a pile (owner feedback 2026-09-28 §7: "piles look like the
// photos: strapped bundles that are unbundled as people take from them"). Mars assembly model v1,
// approximate.
//
// A bundle / stack is ONE static obstacle entity (catalog-stock.ts BUNDLES) whose `contents` carries
// `{ food: 'stock:<piece def>', fraction, count }`. Taking a piece: the crew (the piece's minimum carry
// crew … its maximum) walks to stations on the far side of the take-out spot beside the bundle, pulls
// the top piece off (`unbundle`, PULL_S) and lays it on the spot; the piece then exists as a `stored`
// component lying on the ground, ready for `carry`. The pull itself is not animated: the piece is
// created lying on the spot when the pull completes (one piece per take). The bundle's count drops by
// one; an emptied bundle (its dunnage) is removed. Entities added mid-run → canonicalEntityOrder.
// Refusals: bundle.unknown / bundle.empty / bundle.wrong-piece, bundle.piece-exists, crew.size,
// actor.holding, bundle.too-far (spot not beside the bundle), bundle.spot-occupied (names what is on
// the spot), bundle.station-unreachable.
import { z } from 'zod';
import { dcos, dsin, obbOverlap, rot2, type OBB2, type Vec2 } from '../core/math.ts';
import type { ActionDef, Diagnostic } from '../actions/types.ts';
import { canonicalEntityOrder, type Runtime } from '../runtime/runtime.ts';
import { entityFootprint, type Spatial } from '../spatial/service.ts';
import type { Entity, Pose, Provenance } from '../world/types.ts';
import { def, HUMAN_RADIUS } from '../world/catalog.ts';
import { BUNDLES } from '../world/catalog-stock.ts';
import { checkStations, childrenState, walkCrew, type Children } from './children.ts';
import { holdingDiagnostic } from './rules.ts';

export const PULL_S = 4; // s: unstrap / slide the top piece off onto the spot (≥ 1 person per carry grip)
const fail = (code: string, message: string, subjects: string[]): { ok: false; diagnostic: Diagnostic } => ({ ok: false, diagnostic: { code, message, subjects } });
const f2 = (x: number) => x.toFixed(2);

export type BundleContents = { food: string; fraction: number; count: number };
/** Pieces left in a bundle entity (null if it is not a bundle). */
export function bundleCount(e: Entity | undefined): number | null {
  if (!e || !BUNDLES[e.def]) return null;
  const c = e.contents as Partial<BundleContents> | undefined;
  return typeof c?.count === 'number' ? c.count : null;
}
/** Contents record of a bundle holding `count` pieces. */
export function bundleContents(bundleDef: string, count: number): BundleContents {
  const b = BUNDLES[bundleDef];
  if (!b) throw new Error(`${bundleDef} is not a bundle / stack def`);
  return { food: `stock:${b.piece}`, fraction: count / b.capacity, count };
}
/** A bundle entity (static obstacle) at base centre (x, z), long side along `yaw`. */
export function bundleEntity(id: string, bundleDef: string, x: number, z: number, yaw: number, count: number, groundY: number, provenance: Provenance): Entity {
  const b = BUNDLES[bundleDef];
  if (!b) throw new Error(`${bundleDef} is not a bundle / stack def`);
  if (count < 1 || count > b.capacity) throw new Error(`${id}: count ${count} outside 1…${b.capacity}`);
  const c: BundleContents = bundleContents(bundleDef, count);
  return { id, def: bundleDef, kind: 'fixture', label: `${def(bundleDef).label}`, pose: { p: [x, groundY, z], yaw }, provenance, contents: c };
}

/**
 * Pose of a piece lying on the ground, centred at (x, z), long axis along `heading`:
 * uprights lie flat (canonical pitch-π/2 form, lying.ts), everything else base-down with local x along it.
 */
export function lyingPose(defId: string, x: number, z: number, heading: number, groundY: number): Pose {
  const d = def(defId);
  if (d.category === 'rack-upright') {
    const h = d.size[1], t = d.size[2];
    return { p: [x - dcos(heading) * h / 2, groundY + t / 2, z - dsin(heading) * h / 2], yaw: heading - Math.PI / 2, pitch: Math.PI / 2 };
  }
  return { p: [x, groundY, z], yaw: heading };
}

/** Ground footprint of a piece lying at (x, z) along `heading`. */
export function lyingObb(defId: string, x: number, z: number, heading: number): OBB2 {
  const d = def(defId);
  const [L, W] = d.category === 'rack-upright' ? [d.size[1], d.size[0]] : [d.size[0], d.size[2]];
  return { c: [x, z], half: [L / 2, W / 2], yaw: heading };
}

/**
 * What occupies a ground spot (static obstacles low enough to matter, components / fixtures / vehicles,
 * people within a body radius), ignoring `ignore`. null = free.
 */
export function spotBlocker(rt: Runtime, obb: OBB2, top: number, ignore: string[] = []): string | null {
  const sp = rt.services.spatial as Spatial | undefined;
  const skip = new Set(ignore);
  const g0 = sp?.base.levels.find((l) => l.id === 0)?.y ?? 0;
  for (const o of sp?.base.obstacles ?? []) if ((o.y1 ?? Infinity) > g0 + 0.005 && (o.y0 ?? -Infinity) < top && obbOverlap(o.obb, obb)) return `static ${o.id}`;
  for (const e of Object.values(rt.world.entities)) {
    if (skip.has(e.id)) continue;
    if (e.kind === 'human') {
      const l = rot2([e.pose.p[0] - obb.c[0], e.pose.p[2] - obb.c[1]], -obb.yaw);
      if (Math.abs(l[0]) < obb.half[0] + HUMAN_RADIUS && Math.abs(l[1]) < obb.half[1] + HUMAN_RADIUS) return e.id;
      continue;
    }
    if (e.kind === 'marker') continue;
    const f = entityFootprint(e);
    if (f.y0 < top && obbOverlap(f.obb, obb)) return e.id;
  }
  return null;
}

type P = { crew: string[]; bundle: string; piece: string; to: { x: number; z: number; yaw: number } };
type Prog = { pieceDef: string; stations: { p: Vec2; yaw: number }[]; pose: Pose };
type Exec = { p: P; prog: Prog; id: string; phase: 'approach' | 'pull'; t: number; children?: Children };

function planTake(rt: Runtime, p: P): { ok: true; program: Prog } | { ok: false; diagnostic: Diagnostic } {
  const w = rt.world;
  const b = w.entities[p.bundle];
  const n = bundleCount(b);
  if (!b || n === null) return fail('bundle.unknown', `"${p.bundle}" is not a bundle or stack`, [p.bundle]);
  const spec = BUNDLES[b.def];
  if (n < 1) return fail('bundle.empty', `${p.bundle} (${def(b.def).label}) is empty`, [p.bundle]);
  if (w.entities[p.piece]) return fail('bundle.piece-exists', `an entity "${p.piece}" already exists; a taken piece needs a new id`, [p.piece]);
  const pd = def(spec.piece);
  const [lo, hi] = pd.handling?.carryCrew ?? [1, 1];
  if (new Set(p.crew).size !== p.crew.length || p.crew.length < lo || p.crew.length > hi)
    return fail('crew.size', `taking a ${pd.label} off ${p.bundle} needs ${lo}${hi > lo ? `–${hi}` : ''} distinct people; ${p.crew.length} assigned`, [p.bundle, ...p.crew]);
  for (const c of p.crew) {
    const h = w.entities[c];
    if (h?.kind !== 'human') return fail('entity.unknown', `no person "${c}"`, [c]);
    const d = holdingDiagnostic(w, c);
    if (d) return { ok: false, diagnostic: d };
  }
  const groundY = b.pose.p[1];
  const spot = lyingObb(spec.piece, p.to.x, p.to.z, p.to.yaw);
  const bf = entityFootprint(b).obb;
  // the spot must be right beside the bundle: its centre within (its half-width + 1.3 m) of the bundle's edge
  const l = rot2([p.to.x - bf.c[0], p.to.z - bf.c[1]], -bf.yaw);
  const gap = Math.max(Math.abs(l[0]) - bf.half[0], Math.abs(l[1]) - bf.half[1], 0);
  if (gap > spot.half[1] + 1.3)
    return fail('bundle.too-far', `the take-out spot (${f2(p.to.x)}, ${f2(p.to.z)}) is ${f2(gap)} m from ${p.bundle}; a piece is laid right beside its bundle (≤ ${f2(spot.half[1] + 1.3)} m)`, [p.bundle]);
  const top = groundY + (pd.category === 'rack-upright' ? pd.size[2] : pd.size[1]) + 0.05;
  const blocker = spotBlocker(rt, spot, top, [p.bundle, ...p.crew]);
  if (blocker) return fail('bundle.spot-occupied', `the take-out spot beside ${p.bundle} at (${f2(p.to.x)}, ${f2(p.to.z)}) is occupied by ${blocker}; carry the last piece away first`, [p.bundle, blocker.replace(/^static /, '')]);
  // stations: on the spot's far side from the bundle, spread along the piece
  const away = Math.sign(rot2([p.to.x - bf.c[0], p.to.z - bf.c[1]], -p.to.yaw)[1]) || 1;
  const k = p.crew.length;
  const stations = p.crew.map((_, i) => {
    const s = k === 1 ? 0 : (i / (k - 1) - 0.5) * spot.half[0] * 1.2;
    const o = rot2([s, away * (spot.half[1] + 0.45)], p.to.yaw);
    return { p: [p.to.x + o[0], p.to.z + o[1]] as Vec2, yaw: p.to.yaw - away * Math.PI / 2 };
  });
  return { ok: true, program: { pieceDef: spec.piece, stations, pose: lyingPose(spec.piece, p.to.x, p.to.z, p.to.yaw, groundY) } };
}

export const takeFromBundle: ActionDef<P, Prog, Exec> = {
  verb: 'take_from_bundle',
  description: 'The crew pulls the top piece off a strapped bundle / stack and lays it on the take-out spot beside it (a new stored component, ready to carry); the bundle count drops by one.',
  schema: z.strictObject({
    crew: z.array(z.string().max(80)).min(1).max(4),
    bundle: z.string().max(80),
    piece: z.string().regex(/^[A-Za-z][\w.:-]{0,79}$/),
    to: z.strictObject({ x: z.number(), z: z.number(), yaw: z.number().min(-7).max(7) }),
  }),
  reservations: (_w, p) => [...p.crew.map((c) => ({ resource: `actor:${c}`, mode: 'exclusive' as const })), { resource: `entity:${p.bundle}`, mode: 'exclusive' }],
  plan(rt, p) {
    const r = planTake(rt, p);
    if (!r.ok) return r;
    const un = checkStations(rt, p.crew.map((c, i) => ({ actor: c, p: r.program.stations[i].p })));
    return un ? { ok: false, diagnostic: { ...un, code: 'bundle.station-unreachable' } } : r;
  },
  start: (_rt, p, prog, id) => ({ p, prog, id, phase: 'approach', t: 0 }),
  step(rt, ex, dt) {
    const w = rt.world;
    if (ex.phase === 'approach') {
      if (!ex.children) {
        const r = walkCrew(rt, ex.id, ex.p.crew.map((c, i) => ({ actor: c, p: ex.prog.stations[i].p, yaw: ex.prog.stations[i].yaw })));
        if ('code' in r) return { status: 'failed', diagnostic: { ...r, code: 'bundle.station-unreachable' } };
        ex.children = r;
      }
      const s = childrenState(ex.children);
      if (s === 'running') return { status: 'running', phase: 'approach' };
      if (s !== 'done') return { status: 'failed', diagnostic: s };
      // re-check the spot at the moment of pulling (someone may have set something down)
      const again = planTake(rt, ex.p);
      if (!again.ok) return { status: 'blocked', diagnostic: again.diagnostic };
      ex.phase = 'pull';
      ex.t = 0;
      for (const c of ex.p.crew) Object.assign(w.entities[c].human!, { activity: 'unbundle' });
    }
    ex.t += dt;
    if (ex.t + 1e-9 < PULL_S) return { status: 'running', phase: 'pull' };
    const b = w.entities[ex.p.bundle];
    const n = bundleCount(b)! - 1;
    w.entities[ex.p.piece] = {
      id: ex.p.piece, def: ex.prog.pieceDef, kind: 'component', label: `${def(ex.prog.pieceDef).label} (from ${ex.p.bundle})`, pose: ex.prog.pose,
      provenance: { ...b.provenance, note: `taken from ${ex.p.bundle}; ${b.provenance.note ?? ''}`.trim() }, phase: 'stored', support: { kind: 'ground' },
    };
    if (n > 0) b.contents = bundleContents(b.def, n);
    else delete w.entities[ex.p.bundle];
    canonicalEntityOrder(w);
    for (const c of ex.p.crew) Object.assign(w.entities[c].human!, { activity: 'idle', task: undefined });
    return { status: 'completed', outputs: { piece: ex.p.piece, left: n } };
  },
  cancel(rt, ex) {
    for (const r of ex.children?.recs ?? []) if (rt.isActive(r.id)) rt.cancel(r.id);
    for (const c of ex.p.crew) { const h = rt.world.entities[c]?.human; if (h && h.activity === 'unbundle') h.activity = 'idle'; }
    return { ok: true };
  },
  resumable: true,
};
