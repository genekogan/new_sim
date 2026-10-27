// Ground bridge (lane L8, spec <eden4>/31 B1): an entity world's terrain
// enters the Mars engine. The host logs a rules fact `groundV1 {recipeHash,
// editSeq}` whenever the world compiler's ground recipe changes; the engine
// resolves the recipe by hash (content-addressed: the host keeps every recipe
// it ever logged), builds a GroundField from the same 64 m tiles the browser
// bakes, and enters ground mode: Souls stand on the tiles, route over slope
// and water media, swim deep water. Replay re-derives every height from the
// journal of facts. Worlds without the fact are untouched.
import { areaMask, pathMask, HUMANOID_MEDIA, TILE_M, Terrain, TileSampler, groundRecipeHash, groundSchema, mediaTile, mediumOf, waterLevelCell, watersNear, type Ground } from '../../ground/src/index.ts';
import type { GroundField, GroundV1 } from '../../../mars/viewer/engine/spatial/ground.ts';

/** Content-addressed recipes this process can resolve (filled by the host from its table, and on every commit). */
const RECIPES = new Map<string, Ground>();
/** Register a ground recipe; returns its hash. Idempotent. */
export function registerGroundRecipe(g: Ground): string {
  const parsed = groundSchema.parse(g), h = groundRecipeHash(parsed);
  if (!RECIPES.has(h)) RECIPES.set(h, parsed);
  return h;
}
export function groundRecipe(hash: string): Ground | undefined { return RECIPES.get(hash); }

const FIELDS = new Map<string, GroundField>();
/** The engine's field for a recipe hash (cached: tiles bake once per process). Throws when the recipe is unknown. */
export function groundField(hash: string): GroundField {
  const hit = FIELDS.get(hash);
  if (hit) return hit;
  const g = RECIPES.get(hash);
  if (!g) throw new Error(`ground.recipe-missing: no ground recipe ${hash} is registered (the host must load its recipe table before replay)`);
  const field = fieldOf(g, hash);
  FIELDS.set(hash, field);
  if (FIELDS.size > 16) FIELDS.delete(FIELDS.keys().next().value!);
  return field;
}

function fieldOf(g: Ground, id: string): GroundField {
  const t = new TileSampler(new Terrain(g)), media = new Map<string, Uint8Array>(), wcache = new Map<number, ReturnType<typeof watersNear>>();
  // L1 (speed): the waters near each 8 m cell (was: each 64 m tile). A fine nav tile asks the water level of every 0.1 m
  // cell near water; with Eden 2026's canals that dominated a tile build. levelAmong only ever takes a water whose mask
  // is > 0 at the point (inside its area, or nearer its path than its width), and watersNear keeps every such water for
  // any point of the box, in order, so the answer is identical.
  const NONE: ReturnType<typeof watersNear> = [];
  const wcell = new Map<number, (x: number, z: number) => number | null>();
  const watersAt = (x: number, z: number) => {
    const cx = Math.floor(x / 8), cz = Math.floor(z / 8), k = (cx + 1048576) * 2097152 + (cz + 1048576);
    let w = wcache.get(k); if (!w) { w = watersNear(g, cx * 8 - 1, cz * 8 - 1, (cx + 1) * 8 + 1, (cz + 1) * 8 + 1); if (!w.length) w = NONE; wcache.set(k, w); }
    return w;
  };
  return {
    id, extent: g.extent, wadeMax: HUMANOID_MEDIA.wadeMax, maxSlope: HUMANOID_MEDIA.maxSlope,
    height: (x, z) => t.sample(x, z),
    waterId: (x,z) => { let id: string|null=null; for(const w of watersAt(x,z))if((w.area?areaMask(x,z,w.area,1e-9):pathMask(x,z,w.path!,w.w!))>0)id=w.id; return id; },
    waterBounds: id => { const w=g.waters.find(w=>w.id===id);if(!w)return null;const pts=w.area??w.path!,pad=w.area?0:w.w!;return [Math.min(...pts.map(p=>p[0]))-pad,Math.min(...pts.map(p=>p[1]))-pad,Math.max(...pts.map(p=>p[0]))+pad,Math.max(...pts.map(p=>p[1]))+pad]; },
    waterLevel: (x, z) => {
      // L1 (speed): per 1 m cell, levelAmong compiled once (waterLevelCell: the same answers); a nav tile asks every 0.1 m cell
      const cx = Math.floor(x), cz = Math.floor(z), k = (cx + 1048576) * 2097152 + (cz + 1048576);
      let f = wcell.get(k);
      if (!f) { if (wcell.size >= 16384) wcell.clear(); f = waterLevelCell(watersAt(x, z), g.seaLevel, cx, cz); wcell.set(k, f); }
      return f(x, z);
    },
    medium: (x, z) => mediumOf(t, x, z, HUMANOID_MEDIA, watersAt(x, z)),
    mediaTile: (tx, tz) => { const k = `${tx},${tz}`; let m = media.get(k); if (!m) { m = mediaTile(t, tx, tz, HUMANOID_MEDIA); media.set(k, m); } return m; },
  };
}

/** The fact payload for a recipe (registers it). */
export function groundFact(g: Ground, editSeq: number, opts: { paged?: boolean } = {}): GroundV1 { return { version: 'ground/1', recipeHash: registerGroundRecipe(g), editSeq, ...(opts.paged ? { nav: 'paged/1' as const } : {}) }; }


// ---------------------------------------------------------------- the engine side

import { swimTo, swimIn, shoreToward, groundTravel, inDeepWater, destinationInDeepWater } from '../../../mars/viewer/engine/locomotion/swim.ts';
import { acknowledgeRelocation, humanStaticClearance, humanStaticClearanceWithOverlay, speedWithinCap, SPEED_CAPS } from '../../../mars/viewer/engine/runtime/invariants.ts';
import { entityList } from '../../../mars/viewer/engine/world/entity-list.ts';
import { WALK_SPEED_CAP, setWalkReach } from '../../../mars/viewer/engine/locomotion/walk.ts';
import { G_SWIM, swimRootY } from '../../../mars/viewer/engine/spatial/ground.ts';
import type { Spatial } from '../../../mars/viewer/engine/spatial/service.ts';
import { dcos, dsin } from '../../../mars/viewer/engine/core/math.ts';
export { shoreToward, inDeepWater, destinationInDeepWater };

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rt = { world: any; registry: Map<string, any>; services: Record<string, any>; invariants: any[]; records: Map<string, any>; isActive(id: string): boolean };

/** Verbs a ground world adds to its registry. */
export const GROUND_VERBS = [swimTo, groundTravel, swimIn];
/** The registry with the ground verbs (the same map when they are there already). */
export function groundRegistry(base: Map<string, any>): Map<string, any> {
  if (GROUND_VERBS.every((v) => base.get(v.verb) === v)) return base;
  const m = new Map(base); for (const v of GROUND_VERBS) m.set(v.verb, v); return m;
}

const GROUND_SPEED_CAPS: Readonly<Record<string, number>> = { ...SPEED_CAPS, wade: WALK_SPEED_CAP, swim: WALK_SPEED_CAP, tread: 0.08 };
/** Published speed within the activity's cap, with the ground activities (wade, swim, tread) capped too. */
const groundSpeedWithinCap = (rt: any) => {
  const out: any[] = [];
  for (const e of entityList(rt.world) as any[]) {
    const sp = e.human?.speed; if (sp === undefined) continue;
    const cap = GROUND_SPEED_CAPS[e.human.activity];
    // Stationary activities can publish zero after a walk stops; they need no locomotion speed cap.
    if (sp === 0 || (cap !== undefined && sp <= cap * 1.05)) continue;
    out.push({ code: 'motion.overspeed', message: cap === undefined ? `${e.id} publishes a ground speed of ${sp} m/s in activity ${e.human.activity}, which has no speed cap` : `${e.id} moved at ${sp} m/s in activity ${e.human.activity} (cap ${cap} m/s + 5 %)`, subjects: [e.id], at: e.pose.p });
  }
  return out;
};
/** A swimmer's root is in water, not on standing ground: it is not checked against the walk raster. */
const groundStaticClearance = humanStaticClearanceWithOverlay((rt: any, e: any) => {
  const f = (rt.services.spatial as Spatial).ground?.field;
  return !!f && (e.human.level ?? 0) === 0 && (['swim', 'tread'].includes(e.human.activity) || rt.records.get(e.human.task ?? '')?.verb === 'swim_to' || f.medium(e.pose.p[0], e.pose.p[2]) === G_SWIM);
});
/** The invariants with the ground variants swapped in (idempotent). */
export function groundInvariants(list: any[]): any[] {
  return list.map((inv) => (inv === speedWithinCap ? groundSpeedWithinCap : inv === humanStaticClearance ? groundStaticClearance : inv));
}

/** Points the engine window must cover: every body and the goal of every active movement. */
function coverPoints(rt: Rt): [number, number][] {
  const pts: [number, number][] = [];
  for (const e of Object.values(rt.world.entities) as any[]) if (e.kind === 'human') pts.push([e.pose.p[0], e.pose.p[2]]);
  for (const r of rt.records.values()) if ((r.verb === 'walk_to' || r.verb === 'swim_to' || r.verb === 'ground_travel') && rt.isActive(r.id) && typeof r.params?.x === 'number') pts.push([r.params.x, r.params.z]);
  return pts;
}

/** Paged: the bounds of what remains of every walk in progress (walk.ts execs in services.walkExecs; carry's sub-walks too). */
const coverMemo = new WeakMap<object, Map<number, [number, number, number, number]>>();
function pagedCover(rt: Rt): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  const execs = rt.services.walkExecs as Map<string, { route: { legs: any[] }; leg: number }> | undefined;
  if (execs) for (const ex of execs.values()) {
    let byLeg = coverMemo.get(ex.route);
    if (!byLeg) coverMemo.set(ex.route, (byLeg = new Map()));
    let b = byLeg.get(ex.leg);
    if (!b) {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      const add = (x: number, z: number) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; };
      for (let k = ex.leg; k < ex.route.legs.length; k++) {
        const l = ex.route.legs[k];
        if (l.kind === 'walk') for (const q of l.points) add(q[0], q[1]);
        else if (l.link) { add(l.link.from.p[0], l.link.from.p[1]); add(l.link.to.p[0], l.link.to.p[1]); }
      }
      b = [x0, z0, x1, z1]; byLeg.set(ex.leg, b);
    }
    if (b[0] <= b[2]) out.push(b);
  }
  return out;
}

/** Enter ground mode for the world's `groundV1` (create, restore, install). No fact: nothing changes. */
export function attachGround(rt: Rt): boolean {
  const fact = rt.world.groundV1 as GroundV1 | undefined;
  if (!fact) return false;
  const sp = rt.services.spatial as Spatial;
  const paged = fact.nav === 'paged/1';
  // paged (lane NAV): the windows follow every body and the rest of every walk chunk in progress (restored with the execs)
  sp.pagedCover = paged ? () => pagedCover(rt) : undefined;
  sp.setGround(groundField(fact.recipeHash), rt.world, coverPoints(rt), { paged });
  // GOD-ENV: a god's world may grow past ±500 m; walk_to reaches its bounds (only ground worlds ever get here)
  const ext = groundRecipe(fact.recipeHash)?.extent; if (ext) setWalkReach(Math.max(500, ...ext.map((v) => Math.abs(v))));
  rt.registry = groundRegistry(rt.registry);
  rt.invariants = groundInvariants(rt.invariants);
  return true;
}

/** Height a standing body takes on the ground here (a swimmer's root in deep water). */
export function standHeight(f: GroundField, x: number, z: number): number { return f.medium(x, z) === G_SWIM ? swimRootY(f, x, z) : f.height(x, z); }
/** Floors (2026-10-26): where a body placed at (x, z) on level 0 stands — the nav's standing height (the terrain, or a
 *  floor slab laid on it: a deck, a building's raised floor plate) as every walk tick reads it, the swim root in deep
 *  water. Births, releases and relocations use it, so a body set down on a deck stands on the deck, not under it. */
export function standOn(nav: { field: GroundField; standY(x: number, z: number): number }, x: number, z: number): number { return nav.field.medium(x, z) === G_SWIM ? swimRootY(nav.field, x, z) : nav.standY(x, z); }

/**
 * Bodies follow the ground when it changes under them (a raised hill lifts them, a lowered one sets them down):
 * every person on level 0 who is not seated, lying, aboard or climbing takes the new height. Returns their ids.
 */
export function settleBodies(rt: Rt): string[] {
  const nav = (rt.services.spatial as Spatial).ground, f = nav?.field; if (!nav || !f) return [];
  const moved: string[] = [];
  for (const id of Object.keys(rt.world.entities).sort()) {
    const e = rt.world.entities[id];
    if (e.kind !== 'human' || !e.human || (e.human.level ?? 0) !== 0 || e.human.on || e.human.carrier || e.human.riding || e.human.sleepPose) continue;
    if (e.human.activity.startsWith('sit') || e.human.activity.startsWith('climb') || e.human.activity.startsWith('stand-up')) continue;
    // swimmers (also under a deck: the recipe's water, root below the deck) keep the swimmer root; others stand
    const x = e.pose.p[0], z = e.pose.p[2], swimming = nav.base.medium(x, z) === G_SWIM && (f.medium(x, z) === G_SWIM || e.pose.p[1] < f.height(x, z) - 0.5);
    const y = swimming ? swimRootY(nav.base, x, z) : nav.standY(x, z);
    if (y !== e.pose.p[1]) { e.pose.p = [e.pose.p[0], y, e.pose.p[2]]; acknowledgeRelocation(rt as never, id); moved.push(id); }
  }
  return moved;
}

const factSchemaOk = (f: any): f is GroundV1 => !!f && f.version === 'ground/1' && typeof f.recipeHash === 'string' && /^[0-9a-f]{16}$/.test(f.recipeHash) && Number.isInteger(f.editSeq) && f.editSeq >= 0 && (f.nav === undefined || f.nav === 'paged/1');
/** Why a groundV1 fact cannot be installed (pure), or null. */
export function previewGroundV1(fact: unknown): { code: string; message: string } | null {
  if (!factSchemaOk(fact)) return { code: 'ground.bad-fact', message: '{version:"ground/1", recipeHash:<16 hex>, editSeq:int} required' };
  if (!RECIPES.has(fact.recipeHash)) return { code: 'ground.recipe-missing', message: `no ground recipe ${fact.recipeHash} is registered` };
  return null;
}
/** groundV1 (logged rules fact): the world stands on this ground from now on. Idempotent for the same recipe. */
export function installGroundV1(rt: Rt, fact: GroundV1): { installed: boolean; settled: string[] } {
  const issue = previewGroundV1(fact); if (issue) throw new Error(issue.code);
  const prev = rt.world.groundV1 as GroundV1 | undefined;
  if (prev?.recipeHash === fact.recipeHash && prev.nav === fact.nav) { if (prev.editSeq !== fact.editSeq) rt.world.groundV1 = { ...fact }; return { installed: false, settled: [] }; }
  rt.world.groundV1 = { version: 'ground/1', recipeHash: fact.recipeHash, editSeq: fact.editSeq, ...(fact.nav ? { nav: fact.nav } : {}) };
  attachGround(rt);
  return { installed: true, settled: settleBodies(rt) };
}

/** Arrival on ground worlds: the configured point when a body can stand there, else the nearest such point (rings of 1 m, ≤ 120 m). */
export function groundArrival(rt: Rt, at: [number, number]): [number, number] {
  const f = (rt.services.spatial as Spatial).ground?.field; if (!f) return at;
  const ok = (x: number, z: number) => { const m = f.medium(x, z); return m === 0 || m === 1; };
  if (ok(at[0], at[1])) return at;
  for (let r = 1; r <= 120; r++) { const n = Math.max(8, Math.round(2 * Math.PI * r)); for (let k = 0; k < n; k++) { const a = (k / n) * 2 * Math.PI, x = Math.round((at[0] + dcos(a) * r) * 1000) / 1000, z = Math.round((at[1] + dsin(a) * r) * 1000) / 1000; if (ok(x, z)) return [x, z]; } }
  return at;
}
