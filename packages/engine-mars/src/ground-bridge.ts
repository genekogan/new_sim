// Ground bridge (lane L8, spec <eden4>/31 B1): an entity world's terrain
// enters the Mars engine. The host logs a rules fact `groundV1 {recipeHash,
// editSeq}` whenever the world compiler's ground recipe changes; the engine
// resolves the recipe by hash (content-addressed: the host keeps every recipe
// it ever logged), builds a GroundField from the same 64 m tiles the browser
// bakes, and enters ground mode: Souls stand on the tiles, route over slope
// and water media, swim deep water. Replay re-derives every height from the
// journal of facts. Worlds without the fact are untouched.
import { HUMANOID_MEDIA, TILE_M, Terrain, TileSampler, groundRecipeHash, groundSchema, levelAmong, mediaTile, mediumOf, watersNear, type Ground } from '../../ground/src/index.ts';
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
  const t = new TileSampler(new Terrain(g)), media = new Map<string, Uint8Array>(), wcache = new Map<string, ReturnType<typeof watersNear>>();
  const watersAt = (x: number, z: number) => {
    const tx = Math.floor(x / TILE_M), tz = Math.floor(z / TILE_M), k = `${tx},${tz}`;
    let w = wcache.get(k); if (!w) { w = watersNear(g, tx * TILE_M - 1, tz * TILE_M - 1, (tx + 1) * TILE_M + 1, (tz + 1) * TILE_M + 1); wcache.set(k, w); }
    return w;
  };
  return {
    id, extent: g.extent, wadeMax: HUMANOID_MEDIA.wadeMax, maxSlope: HUMANOID_MEDIA.maxSlope,
    height: (x, z) => t.sample(x, z),
    waterLevel: (x, z) => levelAmong(watersAt(x, z), g.seaLevel, x, z),
    medium: (x, z) => mediumOf(t, x, z, HUMANOID_MEDIA, watersAt(x, z)),
    mediaTile: (tx, tz) => { const k = `${tx},${tz}`; let m = media.get(k); if (!m) { m = mediaTile(t, tx, tz, HUMANOID_MEDIA); media.set(k, m); } return m; },
  };
}

/** The fact payload for a recipe (registers it). */
export function groundFact(g: Ground, editSeq: number): GroundV1 { return { version: 'ground/1', recipeHash: registerGroundRecipe(g), editSeq }; }


// ---------------------------------------------------------------- the engine side

import { swimTo, shoreToward, groundTravel, inDeepWater } from '../../../mars/viewer/engine/locomotion/swim.ts';
import { humanStaticClearance, humanStaticClearanceWithOverlay, speedWithinCap, SPEED_CAPS } from '../../../mars/viewer/engine/runtime/invariants.ts';
import { WALK_SPEED_CAP } from '../../../mars/viewer/engine/locomotion/walk.ts';
import { G_SWIM, swimRootY } from '../../../mars/viewer/engine/spatial/ground.ts';
import type { Spatial } from '../../../mars/viewer/engine/spatial/service.ts';
import { dcos, dsin } from '../../../mars/viewer/engine/core/math.ts';
export { shoreToward, inDeepWater };

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rt = { world: any; registry: Map<string, any>; services: Record<string, any>; invariants: any[]; records: Map<string, any>; isActive(id: string): boolean };

/** Verbs a ground world adds to its registry. */
export const GROUND_VERBS = [swimTo, groundTravel];
/** The registry with the ground verbs (the same map when they are there already). */
export function groundRegistry(base: Map<string, any>): Map<string, any> {
  if (GROUND_VERBS.every((v) => base.get(v.verb) === v)) return base;
  const m = new Map(base); for (const v of GROUND_VERBS) m.set(v.verb, v); return m;
}

const GROUND_SPEED_CAPS: Readonly<Record<string, number>> = { ...SPEED_CAPS, wade: WALK_SPEED_CAP, swim: WALK_SPEED_CAP, tread: 0.08 };
/** Published speed within the activity's cap, with the ground activities (wade, swim, tread) capped too. */
const groundSpeedWithinCap = (rt: any) => {
  const out: any[] = [];
  for (const e of Object.values(rt.world.entities) as any[]) {
    const sp = e.human?.speed; if (sp === undefined) continue;
    const cap = GROUND_SPEED_CAPS[e.human.activity];
    if (cap !== undefined && sp <= cap * 1.05) continue;
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

/** Enter ground mode for the world's `groundV1` (create, restore, install). No fact: nothing changes. */
export function attachGround(rt: Rt): boolean {
  const fact = rt.world.groundV1 as GroundV1 | undefined;
  if (!fact) return false;
  const sp = rt.services.spatial as Spatial;
  sp.setGround(groundField(fact.recipeHash), rt.world, coverPoints(rt));
  rt.registry = groundRegistry(rt.registry);
  rt.invariants = groundInvariants(rt.invariants);
  return true;
}

/** Height a standing body takes on the ground here (a swimmer's root in deep water). */
export function standHeight(f: GroundField, x: number, z: number): number { return f.medium(x, z) === G_SWIM ? swimRootY(f, x, z) : f.height(x, z); }

/**
 * Bodies follow the ground when it changes under them (a raised hill lifts them, a lowered one sets them down):
 * every person on level 0 who is not seated, lying, aboard or climbing takes the new height. Returns their ids.
 */
export function settleBodies(rt: Rt): string[] {
  const f = (rt.services.spatial as Spatial).ground?.field; if (!f) return [];
  const moved: string[] = [];
  for (const id of Object.keys(rt.world.entities).sort()) {
    const e = rt.world.entities[id];
    if (e.kind !== 'human' || !e.human || (e.human.level ?? 0) !== 0 || e.human.on || e.human.carrier || e.human.riding || e.human.sleepPose) continue;
    if (e.human.activity.startsWith('sit') || e.human.activity.startsWith('climb') || e.human.activity.startsWith('stand-up')) continue;
    const y = standHeight(f, e.pose.p[0], e.pose.p[2]);
    if (y !== e.pose.p[1]) { e.pose.p = [e.pose.p[0], y, e.pose.p[2]]; moved.push(id); }
  }
  return moved;
}

const factSchemaOk = (f: any): f is GroundV1 => !!f && f.version === 'ground/1' && typeof f.recipeHash === 'string' && /^[0-9a-f]{16}$/.test(f.recipeHash) && Number.isInteger(f.editSeq) && f.editSeq >= 0;
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
  if (prev?.recipeHash === fact.recipeHash) { if (prev.editSeq !== fact.editSeq) rt.world.groundV1 = { ...fact }; return { installed: false, settled: [] }; }
  rt.world.groundV1 = { version: 'ground/1', recipeHash: fact.recipeHash, editSeq: fact.editSeq };
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
