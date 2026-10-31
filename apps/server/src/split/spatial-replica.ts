// Stage B (lane B-spatial, tranche 2026-10-31): the engine's own spatial service, running in the read worker.
//
// The read path (`binds()`, `here`, together, god nav) asks the engine spatial questions: clearance, nearest standable,
// clear spots, connectivity, seat levels. A hand-written index cannot reproduce those answers, but the spatial service is
// shared TypeScript with no engine behind it, so the worker builds its own instance from the engine's static scene export
// (MarsEngine.exportStaticScene, one per static epoch) plus the replicated bodies, and answers the same reads with the
// same signatures and the same code as the engine's methods (packages/engine-mars/src/engine.ts; each read below names
// the method it mirrors). The replica is a pure function of its inputs: the export, the bodies, and (for seat levels)
// the fixture rows of the read model. It never touches the live engine.
//
// Dynamic inputs (see the lane status file, "Seams"): body positions must be exact (no rounding) and say which entities
// are human bodies; seat levels read the fixture's def, kind, support, logged level and height; a rebuild follows the
// export's `epoch` (staticEpochV1) and its `physicsHash` (the scene lists can change with entity physics alone).
import { Spatial, type StaticExportV1 } from '../../../../mars/viewer/engine/spatial/service.ts';
import type { TileRect } from '../../../../mars/viewer/engine/spatial/tiled.ts';
import { NavConnectivity, type ConnPoint, type ConnVerdict } from '../../../../mars/viewer/engine/spatial/connectivity.ts';
import { G_SWIM, swimRootY } from '../../../../mars/viewer/engine/spatial/ground.ts';
import { dcos, dsin, hypot } from '../../../../mars/viewer/engine/core/math.ts';
import { HUMAN_RADIUS } from '../../../../mars/viewer/engine/world/catalog.ts';
import { HUMAN_PROFILE } from '../../../../mars/viewer/engine/spatial/types.ts';
import { LIE_CLEARANCE } from '../../../../mars/viewer/engine/social/pose.ts';
import type { WorldState } from '../../../../mars/viewer/engine/world/types.ts';
import { groundField, registerGroundRecipe } from '../../../../packages/engine-mars/src/ground-bridge.ts';

type Vec2 = [number, number];
/** A replicated body: exact position (no rounding), level, and whether it is a human body (people the reads avoid). */
export type ReplicaBody = { id: string; x: number; y: number; z: number; level: number; human: boolean };
/** Body changes since the last apply: rows upserted (whole rows), ids gone. */
export type BodyDelta = { bodies?: ReplicaBody[]; gone?: string[] };
/** What seat levels read of a fixture (engine social/slots.ts levelOf + fixtureSlots). */
export type FixtureRow = { id: string; def: string; kind: string; support?: string; level?: number; y: number };
export type ReplicaOpts = {
  /** The read model's fixture lookup (nativeSeatLevelsV1). Absent: every seat read answers []. */
  fixture?: (id: string) => FixtureRow | undefined;
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const inPoly = (x: number, z: number, poly: [number, number][]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
/** engine.ts levelGridsFor: the level-0 test for each point of a polygon read, per 64 m tile on paged ground. */
function levelGridsFor(spatial: Spatial, centre: (q: Vec2) => boolean, t: number) {
  const paged = spatial.ground?.paged === true, tiles = new Map<string, ((q: Vec2) => boolean) | null>();
  return (x: number, z: number): boolean => { if (!paged) return centre([x, z]); const k = Math.floor(x / 64) + ',' + Math.floor(z / 64); if (!tiles.has(k)) tiles.set(k, spatial.clearTester(0, [x, z], t)); const r = tiles.get(k); return r ? r([x, z]) : false; };
}

export class SpatialReplica {
  spatial: Spatial;
  scene: StaticExportV1;
  /** The world the service syncs against: no static entities (they are in the export's lists), no bodies. */
  private world: WorldState;
  private bodies = new Map<string, ReplicaBody>();
  private conn?: NavConnectivity;
  private opts: ReplicaOpts;
  private seatDefs: Set<string>;
  /** Build timings (ms) of the last fromStaticScene / rebuild. */
  readonly stats = { buildMs: 0, rebuildMs: 0, rebuilds: 0, rebased: 0 };

  private constructor(scene: StaticExportV1, spatial: Spatial, world: WorldState, opts: ReplicaOpts) { this.scene = scene; this.spatial = spatial; this.world = world; this.opts = opts; this.seatDefs = new Set(scene.seatDefs); }

  /** A replica over one static export and the bodies now (structured-cloned data; no engine object). */
  static fromStaticScene(scene: StaticExportV1, bodies: ReplicaBody[], opts: ReplicaOpts = {}): SpatialReplica {
    const t0 = performance.now(), world = { tick: 0, entities: {} } as unknown as WorldState;
    const r = new SpatialReplica(scene, Spatial.fromStaticScene(scene, world, fieldOf(scene)), world, opts);
    for (const b of bodies) r.bodies.set(b.id, b);
    r.stats.buildMs = performance.now() - t0;
    return r;
  }

  /** Body positions changed (rows upserted whole) or bodies left. */
  applyBodies(delta: BodyDelta): void {
    if (delta.bodies) for (const b of delta.bodies) this.bodies.set(b.id, b);
    if (delta.gone) for (const id of delta.gone) this.bodies.delete(id);
  }

  /** Paged ground: the windows the engine's service faces now (its pageRectsV1). A read near a window's edge answers
   *  from that window, so the replica holds the same ones. Null: the replica's own (no bodies: one window at the origin). */
  applyPages(rects: TileRect[] | null): void {
    const key = rects ? rects.map((r) => r.join(',')).join(';') : '';
    if (key === this.pagesKey) return;
    this.pagesKey = key; this.pages = rects; this.spatial.pinPagesV1(rects, this.world);
  }
  private pagesKey = '';
  private pages: TileRect[] | null = null;
  /** Whether the engine's connectivity labels are ready (its navWarmV1(0)): a poll answers that, after this replica's own
   *  labels are complete. Undefined: the replica's own warm state answers. */
  applyNavReady(ready: boolean | undefined): void { this.navReady = ready; }
  private navReady: boolean | undefined;

  /** A newer static export (epoch or physics hash moved): rebase the service in place (ground tiles rebuilt only where
   *  their content changed), or build anew when the cell, planner or ground mode changed. Connectivity relabels lazily. */
  rebuild(scene: StaticExportV1): void {
    const t0 = performance.now();
    const same = scene.recipeHash === this.scene.recipeHash && this.spatial.rebaseStatic(scene, this.world);
    if (!same) { this.spatial = Spatial.fromStaticScene(scene, this.world, fieldOf(scene)); this.conn = undefined; if (this.pages) this.spatial.pinPagesV1(this.pages, this.world); } else this.stats.rebased++;
    this.scene = scene; this.seatDefs = new Set(scene.seatDefs);
    this.stats.rebuilds++; this.stats.rebuildMs = performance.now() - t0;
  }

  /** Whether `scene` is a different static world than the one held (the trigger for rebuild). */
  differs(scene: { epoch: number; physicsHash: string | null }): boolean { return scene.epoch !== this.scene.epoch || scene.physicsHash !== this.scene.physicsHash; }

  private people(except: string | undefined, level?: number): Vec2[] {
    const out: Vec2[] = [];
    for (const b of this.bodies.values()) if (b.human && b.id !== except && (level === undefined || b.level === level)) out.push([b.x, b.z]);
    return out;
  }
  private sync(): Spatial { const sp = this.spatial; sp.sync(this.world); return sp; }

  // ---- the engine's reads (same signatures, same code) ----

  /** B-facade: the synced service, for the engine reads ReplicaWorld answers over its own world view (movementVerb,
   *  bodyWaterDepthV1: they read a body's pose and the ground field). */
  service(): Spatial { return this.sync(); }
  /** engine.reachV1 (B-facade item 2): the planner's route proof between two standing points, over the replica's service. */
  /** The planner's route between two standing points (proveUnreachable: a failing search ends early, same answer). */
  routeV1(from: { p: Vec2; level?: number }, to: { p: Vec2; level?: number }) {
    return this.sync().route(this.world, HUMAN_PROFILE, { level: from.level ?? 0, p: from.p }, { level: to.level ?? 0, p: to.p }, { proveUnreachable: true }) as
      { ok: true; route: { length: number; legs: { kind: string; level?: number; link?: { to: { level: number } } }[] } } | { ok: false; diagnostic: { code: string; message: string } };
  }
  reachV1(from: { p: Vec2; level?: number }, to: { p: Vec2; level?: number }): { ok: true; length: number; legs: number; levels: number[] } | { ok: false; code: string; message: string } {
    const r = this.routeV1(from, to);
    if (!r.ok) return { ok: false, code: r.diagnostic.code, message: r.diagnostic.message };
    const levels = [...new Set(r.route.legs.map((l) => l.kind === 'walk' ? l.level! : l.link!.to.level))];
    return { ok: true, length: Math.round(r.route.length * 100) / 100, legs: r.route.legs.length, levels };
  }

  /** engine.staticEpochV1 */
  staticEpochV1(): number { return this.scene.epoch; }
  /** engine.navEpochV1 */
  navEpochV1(): number { return this.scene.navEpoch; }
  /** engine.readPassV1: the replica's service is already synced; one sync up front, as the engine's. */
  readPassV1<T>(fn: () => T): T { return this.spatial.readPass(this.world, fn); }
  /** engine.levelsV1 */
  levelsV1(): { id: number; y: number }[] { return this.scene.baseLevels.map((l) => ({ id: l.id, y: l.y })); }
  /** engine.clearanceAtV1 */
  clearanceAtV1(x: number, z: number, level = 0): number { const clear = this.sync().clearanceReader(level, [x, z]); return clear ? clear([x, z]) : 0; }
  /** engine.clearanceUpToV1 */
  clearanceUpToV1(x: number, z: number, cap = 1, level = 0): number { const read = this.sync().clearanceCapped(level, [x, z], cap); return read ? read([x, z]) : 0; }
  /** engine.lyingRoomAtV1 */
  lyingRoomAtV1(x: number, z: number, level = 0, sampleMargin = 0): boolean {
    const spatial = this.sync(), need = LIE_CLEARANCE + sampleMargin + Math.SQRT2 * spatial.cell;
    const read = spatial.clearanceCapped(level, [x, z], need); return !!read && read([x, z]) >= need;
  }
  /** engine.standYAtV1 (ground-bridge standOn on level 0 of a ground world) */
  standYAtV1(x: number, z: number, level = 0): number | null {
    const spatial = this.sync();
    if (level === 0 && this.scene.ground && spatial.ground) { const g = spatial.ground; return r3(g.field.medium(x, z) === G_SWIM ? swimRootY(g.field, x, z) : g.standY(x, z)); }
    const l = spatial.scene.levels.find((v) => v.id === level); return l ? l.y : null;
  }
  /** engine.dryGroundAtV1 (a physical binding's shore domain is world state the export does not carry: throws) */
  dryGroundAtV1(x: number, z: number): boolean {
    if (this.scene.physical) throw new Error('spatial-replica: dryGroundAtV1 on a physical binding needs its shore domain');
    const f = this.spatial.ground?.field; return !f || f.medium(x, z) === 0;
  }
  /** engine.nearestStandableV1 */
  nearestStandableV1(at: Vec2, except?: string, minClear = HUMAN_RADIUS + .15, maxRing = 80): Vec2 | null {
    const spatial = this.sync(), clear = spatial.clearTester(0, at, minClear); if (!clear) return null;
    const people = this.people(except);
    for (let ring = 0; ring <= maxRing; ring++) { const n = Math.max(1, ring * 8); for (let k = 0; k < n; k++) {
      const ang = (k / n) * Math.PI * 2, x = r3(at[0] + dcos(ang) * ring * .5), z = r3(at[1] + dsin(ang) * ring * .5);
      if (!clear([x, z]) || people.some(([px, pz]) => hypot(px - x, pz - z) < .8)) continue; return [x, z]; } }
    return null;
  }
  /** engine.standableNearV1 */
  standableNearV1(at: Vec2, level = 0, except?: string, minClear = HUMAN_RADIUS + .12, maxRing = 24): Vec2 | null {
    const spatial = this.sync(), clear = spatial.clearTester(level, at, minClear); if (!clear) return null;
    const people = this.people(except, level);
    for (let ring = 0; ring <= maxRing; ring++) { const n = Math.max(1, ring * 8); for (let k = 0; k < n; k++) {
      const ang = (k / n) * Math.PI * 2, x = r3(at[0] + dcos(ang) * ring * .25), z = r3(at[1] + dsin(ang) * ring * .25);
      if (!clear([x, z]) || people.some(([px, pz]) => hypot(px - x, pz - z) < .7)) continue; return [x, z]; } }
    return null;
  }
  /** engine.clearSpotsV1 */
  clearSpotsV1(polygon: [number, number][], n: number): Vec2[] {
    const spatial = this.sync(); if (!Array.isArray(polygon) || polygon.length < 3) return [];
    const centre = spatial.clearTester(0, [polygon.reduce((s, v) => s + v[0], 0) / polygon.length, polygon.reduce((s, v) => s + v[1], 0) / polygon.length], HUMAN_RADIUS + .4); if (!centre) return [];
    const xs = polygon.map((v) => v[0]), zs = polygon.map((v) => v[1]), cand: Vec2[] = [], clearOf = levelGridsFor(spatial, centre, HUMAN_RADIUS + .4);
    for (let x = Math.ceil(Math.min(...xs)) + 1; x < Math.max(...xs); x += 2) for (let z = Math.ceil(Math.min(...zs)) + 1; z < Math.max(...zs); z += 2) { if (!inPoly(x, z, polygon)) continue; if (clearOf(x, z)) cand.push([x, z]); }
    if (!cand.length) return [];
    const cx = xs.reduce((a, b) => a + b, 0) / xs.length, cz = zs.reduce((a, b) => a + b, 0) / zs.length;
    const out: Vec2[] = [cand.reduce((b, p) => hypot(p[0] - cx, p[1] - cz) < hypot(b[0] - cx, b[1] - cz) ? p : b)];
    while (out.length < Math.min(n, cand.length)) { let best = cand[0], bd = -1; for (const p of cand) { const d = Math.min(...out.map((q) => hypot(p[0] - q[0], p[1] - q[1]))); if (d > bd) { bd = d; best = p; } } if (bd <= 0) break; out.push(best); }
    return out;
  }
  /** engine.navWarmV1 */
  navWarmV1(budgetMs: number): boolean {
    const started = performance.now(), spatial = this.sync(), arrival = this.scene.arrival;
    if (!this.conn || this.conn.spatial !== spatial) this.conn = new NavConnectivity(spatial, { anchors: () => [arrival] });
    if (this.navReady !== undefined) { if (this.navReady) this.conn.update(Infinity); return this.navReady; }
    return this.conn.update(budgetMs === Infinity ? Infinity : Math.max(0, budgetMs - (performance.now() - started)));
  }
  /** B-facade (read worker): label connectivity now, whatever main's own warm state is (a worker warms before 'ready'
   *  and after a rebuild, never inside a Soul's read). Returns the ms it took. */
  warmLabelsV1(): number {
    const t0 = performance.now(), spatial = this.sync();
    if (!this.conn || this.conn.spatial !== spatial) this.conn = new NavConnectivity(spatial, { anchors: () => [this.scene.arrival] });
    this.conn.update(Infinity); return performance.now() - t0;
  }
  /** One slice of labelling (budget ms): true when the labels are complete. */
  warmSliceV1(budgetMs: number): boolean {
    const spatial = this.sync();
    if (!this.conn || this.conn.spatial !== spatial) this.conn = new NavConnectivity(spatial, { anchors: () => [this.scene.arrival] });
    return this.conn.update(budgetMs);
  }
  /** engine.connectivityV1 */
  connectivityV1(): NavConnectivity { this.navWarmV1(Infinity); return this.conn!; }
  /** engine.navCheckV1 */
  navCheckV1(points: ConnPoint[]): ConnVerdict[] { return this.connectivityV1().check(points); }
  /** engine.navNearestMainV1 */
  navNearestMainV1(p: Vec2, except?: string, maxR = 40): Vec2 | null {
    const c = this.connectivityV1(), people = this.people(except, 0);
    return c.nearestMain(p, maxR, undefined, (q) => people.some(([x, z]) => hypot(x - q[0], z - q[1]) < .8));
  }
  /** engine.nativeSeatLevelsV1 (social/slots.ts fixtureSlots + levelOf: every seat of a fixture shares its level) */
  nativeSeatLevelsV1(fixture: string): number[] {
    const e = this.opts.fixture?.(fixture); if (!e) return [];
    if (!this.seatDefs.has(e.def)) return [];
    const levels = this.scene.baseLevels.length ? this.scene.baseLevels : [{ id: 0, y: 0, label: 'ground' }];
    if (this.scene.ground && e.kind === 'fixture' && e.support === 'ground') return [0];
    if (e.kind === 'fixture' && typeof e.level === 'number' && levels.some((l) => l.id === e.level)) return [e.level];
    let best = levels[0].id, bd = Infinity;
    for (const l of levels) { const d = Math.abs(l.y - e.y); if (d < bd) { bd = d; best = l.id; } }
    return [best];
  }
}

/** The ground field an export is baked on (its recipe registered in this thread first). */
function fieldOf(scene: StaticExportV1) {
  if (!scene.ground) return undefined;
  if (!scene.recipeHash || !scene.recipe) throw new Error('spatial-replica: a ground export without its recipe');
  const h = registerGroundRecipe(scene.recipe as Parameters<typeof registerGroundRecipe>[0]);
  if (h !== scene.recipeHash) throw new Error(`spatial-replica: recipe hash ${h} is not the export's ${scene.recipeHash}`);
  return groundField(h);
}
