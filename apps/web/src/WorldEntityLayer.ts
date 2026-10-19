// The entity world's picture (spec <eden4>/28 §8): terrain baked from the
// same ground recipe the server uses, water, a horizon ring, and one mesh per
// placed entity drawn from its def. Diffs arrive over the hub as
// `{type:'edge', kind:'world-diff'}`; new or moved things ease in over ~2.5 s.
// Inactive (and invisible) on worlds that have no entity layer.
import { noteModeration, noteSnapshotVersion } from './moderation-hidden.ts';
import { loadSnapshot } from './snapshot-wire.ts';
import * as THREE from 'three';
import { TILE_M, TILE_N, Terrain, waterLevelAt, type Ground } from '@sim/ground';
import { WorldModel, type Def, type Entity, type StoredDef } from '@sim/world-compiler';
import { GENERATORS } from '@sim/generators';
import { meshFor, type MeshCtx } from './gen-mesh/index.ts';
import { clearBuildingPrefetch, prefetchBuilding } from './gen-mesh/building.mesh.ts';
import { MaterialLib } from './gen-mesh/materials.ts';
import { animate, hasMotion } from './gen-mesh/motion.ts';
import { EntityInstancer, instanceable } from './EntityInstancer.ts';
import { terrainColorFor, terrainColorDeferred, groundRealismFor } from './gen-mesh/ground-palette.ts';
import { mottleSector } from './gen-mesh/terrain-mottle.ts';
import { applyWorldRealism } from './WorldEdenRealism.ts';
import { stepSurfaceKit } from './WorldEdenSurfaceKit.ts';
import { waterMaterial, waterMesh } from './gen-mesh/water.ts';
import { assetUrl, loadAsset } from './gen-mesh/gltf-assets.ts';
import { assetBytes } from './asset-bytes.ts';
import { eagerShas, planEager } from './gen-mesh/lazy-assets.ts';
import { computeVertexNormals } from './gen-mesh/fast-geometry.ts';
import { entityArrivalPose } from './entity-arrival.ts';
import { WorldBuildSites, SITE_REFINEMENT, type PublicSite } from './WorldBuildSites.ts';
import { GroundCover, coverSetting } from './gen-mesh/ground-cover.ts';

type Snapshot = { contract: string; worldId: string; seq: number; counter?: number; seed?: string; constants: WorldModel['constants']; state: WorldModel['state']; ground: Ground; defs: StoredDef[]; entities: Entity[]; tiles: Record<string, string>; assetBytes?: Record<string, number>; builds?: PublicSite[]; buildsRev?: number; now?: number };
type DiffMsg = { type: 'edge'; kind: 'world-diff'; seq: number; diff: { upserts: Entity[]; removes: string[]; defs: StoredDef[]; tiles: string[]; world?: Partial<WorldModel['state']> }; ground?: Ground; defs?: StoredDef[] };

const SECTOR_TILES = 4;              // 4×4 tiles (256 m) per terrain mesh
const TERRAIN_STEP = 2;              // metres between terrain vertices in the picture
const WATER_SINK_M = 0.03;          // still water drawn this far below its level (no z-fighting with a rim at the level)
const EASE_IN_S = 2.5, EASE_OUT_S = 0.6, DROP_M = 40;
const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

type Figure = { holder: THREE.Object3D; wrists: [THREE.Object3D, THREE.Object3D]; knuckles: [THREE.Object3D | null, THREE.Object3D | null] } | { missingAt: number };
type Drawn = { inst?: string; settled?: boolean; shown?: boolean; obj: THREE.Object3D; from: { p: THREE.Vector3; s: number }; to: { p: THREE.Vector3; s: number }; t0: number; dur: number; removing?: boolean; defHash: string; world?: boolean; motion?: { entity: Entity; def: StoredDef; yaw: number } };

export class WorldEntityLayer {
  readonly group = new THREE.Group();
  active = false;
  /** The first build is under way (start): nothing to draw or diff yet. */
  building = false;
  private model: WorldModel | null = null;
  private seq = -1;
  private readonly terrainGroup = new THREE.Group();
  private readonly waterGroup = new THREE.Group();
  private readonly thingsGroup = new THREE.Group();
  private sectors = new Map<string, THREE.Mesh>();
  private drawn = new Map<string, Drawn>();
  private materials = new Map<string, THREE.Material>();
  readonly lib = new MaterialLib();
  readonly instancer = new EntityInstancer();
  readonly sites: WorldBuildSites;
  /** W4: old Eden's tall grass, tufts and wildflowers, drawn around the camera from the ground recipe. */
  readonly cover = new GroundCover(() => (this.active ? this.model : null), coverSetting(), () => this.seq);
  get entityCount() { return this.model?.entities.size ?? 0; }
  /** The placed entities once this layer's picture has reached edit `seq` (else null): GodPanel's flags read them here
   *  instead of downloading the public snapshot again on every edit (lane L3h). */
  entitiesAt(seq: number): Iterable<Entity> | null { return this.model && this.seq >= seq ? this.model.entities.values() : null; }
  private horizon: THREE.Mesh | null = null;
  /** MARSLAND-FAR: entities whose def is tagged `horizon` (core/far-land@1, core/panorama@1) replace the green ring. */
  private horizonBy = new Set<string>();
  private hiddenBase = new WeakSet<THREE.Object3D>();
  /** Viewer B7: things a body carries (entity parent = a body entity) by body id; they ride that figure's animated hand. */
  private held = new Map<string, string>();
  private figures = new Map<string, Figure>();
  private now = 0;
  private readonly api: (p: string) => string;
  constructor(api: (p: string) => string) {
    this.api = api;
    this.sites = new WorldBuildSites({ model: () => this.model, groundAt: this.groundAt, fetchBuilds: async () => {
      const r = await fetch(this.api('/v1/world/builds'), { signal: this.signal ?? undefined, cache: 'no-store' });
      if (!r.ok) throw Error(`Build snapshot: ${r.status}`);
      return r.json();
    } });
    this.group.name = 'entity-world';
    this.group.add(this.terrainGroup, this.waterGroup, this.thingsGroup, this.instancer.group, this.sites.group, this.cover.group);
  }

  private signal: AbortSignal | null = null;
  private lastSeqCheck = 0;
  private resyncing = false;
  /** Full resync: refetch the snapshot and redraw everything (no easing). Used after a missed diff. */
  async resync() {
    if (this.resyncing || !this.signal) return;
    this.resyncing = true;
    try {
      const got = await loadSnapshot(this.api('/v1/world/snapshot'), this.signal); if (!got) return; const r = got.response; noteSnapshotVersion(r.headers.get('x-moderation-version'));
      const snap = got.snap as unknown as Snapshot; if (this.signal.aborted || snap.contract !== 'world/1') return;
      ageNow(snap, r);
      const prevGround = JSON.stringify(this.model?.ground() ?? null);
      this.model = WorldModel.fromSnapshot({ constants: snap.constants, state: snap.state, seed: snap.seed ?? 'viewer', seq: snap.counter ?? 0, editSeq: snap.seq, defs: snap.defs, entities: snap.entities, ground: snap.ground }, undefined, undefined, { lazyIndex: true });
      this.seq = snap.seq;
      this.sites.reset(snap.builds ?? [], snap.buildsRev ?? 0, snap.now);
      this.sites.refreshAll(JSON.stringify(snap.ground) !== prevGround);
      if (JSON.stringify(snap.ground) !== prevGround) { this.rebuildTerrain(); this.rebuildWater(); this.buildHorizon(); }
      const keep = new Set(snap.entities.map((e) => e.id));
      for (const id of [...this.drawn.keys()]) if (!keep.has(id)) this.undraw(id);
      this.model.readPass(() => { for (const e of snap.entities) this.draw(e, !this.drawn.has(e.id)); });
      this.stats.resyncs++;
    } catch { /* next check retries */ } finally { this.resyncing = false; }
  }

  async start(signal: AbortSignal) {
    this.signal = signal;
    let snap: Snapshot;
    // lane L3h: the first start takes the snapshot GET index.html sent at page entry (snapshot-prefetch.ts), one request
    // lane W1/O2: the page's edge-cacheable snapshot URL when the server named one (its `now` is then as old as the copy)
    // lane W3: in its wire form (snapshot-wire.ts: defs and ground as cached content-addressed parts)
    try { const got = await loadSnapshot(this.api('/v1/world/snapshot'), signal, true); if (!got || signal.aborted) return; const r = got.response; noteSnapshotVersion(r.headers.get('x-moderation-version')); snap = got.snap as unknown as Snapshot;
      ageNow(snap, r); } catch { return; }
    if (signal.aborted || snap.contract !== 'world/1') return;
    this.model = WorldModel.fromSnapshot({ constants: snap.constants, state: snap.state, seed: snap.seed ?? 'viewer', seq: snap.counter ?? 0, editSeq: snap.seq, defs: snap.defs, entities: snap.entities, ground: snap.ground }, undefined, undefined, { lazyIndex: true });
    // the loading bar's total: VOCAB-MECH lazy GLBs (gen-mesh/lazy-assets.ts) — only the eager set, nearest the arrival
    // lane PERF: nearest the arrival target (entity-arrival.ts frames the centre of what was built; ?at= for shots), not the origin
    const m0 = this.model, q = new URLSearchParams(location.search), at = q.get('at')?.split(',').map(Number), eyeQ = q.get('eye')?.split(',').map(Number);
    const pose = at?.length === 3 && eyeQ?.length === 3 && [...at, ...eyeQ].every(Number.isFinite) ? { target: at, eye: eyeQ } : entityArrivalPose(this.viewBounds(), this.entityCount, this.groundAt, 45, innerWidth / Math.max(1, innerHeight), 1, this.arrivalAt());
    const eagerSizes = planEager(snap, (r) => m0.resolvedDef(r), (e) => { try { const p = m0.worldPose(e); return [p.x, p.z]; } catch { return null; } }, [pose.target[0], pose.target[2]], [pose.eye[0], pose.eye[2]]);
    assetBytes.expect(Object.fromEntries(Object.entries(eagerSizes).map(([sha, n]) => [assetUrl(sha), n])));
    // Phone arrival (lane d3): start the eager GLBs now, nearest first, so they download while the terrain and every
    // thing's holder are built (~2 s of main thread on a 4x phone) instead of after; each thing's own loadAsset(sha)
    // then joins the same cached promise. The arrival card still waits for them to be drawn.
    for (const sha of eagerShas()) void loadAsset(sha).catch(() => {});
    this.seq = snap.seq;
    this.sites.reset(snap.builds ?? [], snap.buildsRev ?? 0, snap.now);
    // lane W1: the first build runs in slices of ~50 ms with the main thread free in between, so the socket's join set,
    // the first takes and the initial downloads proceed while it builds (the arrival card covers it; LiveWorld draws
    // nothing while `building`). Same draws in the same order; edge diffs wait until it is done (applyEdge).
    this.building = true;
    try {
      const m = this.model;
      // lane W1: every building's geometry starts in the building workers now; the slices below wait for one only when
      // they reach it before it is done (building.mesh.ts prefetchBuilding)
      const pending = new Map<string, Promise<void>>();
      for (const e of snap.entities) {
        const def = m.resolvedDef(e.def); if (!def || def.make.kind !== 'gen' || meshFor(def)?.gen !== 'building/1') continue;
        try { const p = prefetchBuilding({ def, entity: e, params: paramsOf(e, def), args: (def.make.args ?? {}) as Record<string, unknown> }); if (p) { pending.set(e.id, p); void p.then(() => pending.delete(e.id)); } } catch { /* built in place */ }
      }
      this.rebuildTerrain(undefined, true);   // lane L3: the first build's playa mottling runs in a worker (terrain-mottle.ts)
      await nextTask(); if (signal.aborted || this.model !== m) return;
      this.rebuildWater();
      this.buildHorizon();
      const all = snap.entities;
      for (let i = 0; i < all.length;) {
        const until = performance.now() + BUILD_SLICE_MS;
        m.readPass(() => { while (i < all.length && !pending.has(all[i].id)) { this.draw(all[i++], false); if (performance.now() >= until) break; } });
        const wait = i < all.length ? pending.get(all[i].id) : undefined;
        if (wait) await Promise.race([wait, new Promise((r) => setTimeout(r, 3000))]).then(() => pending.delete(all[i].id));
        else if (i < all.length) await nextTask();
        if (signal.aborted || this.model !== m) return;
      }
      this.active = true;
    } finally { this.building = false; clearBuildingPrefetch(); }
  }

  /** Consume hub messages (the viewer keeps the last 300 edge messages; we only act on newer diffs). */
  readonly stats = { edgeSeen: 0, applied: 0, resyncs: 0, lastError: null as string | null };
  applyEdge(msgs: readonly { type: string; kind?: string; seq?: unknown; rev?: unknown }[]) {
    if (!this.model || this.building) return;
    for (const m of msgs) {
      // CE8: attention hints keep the current rev; the sites layer parses each message once.
      if (m.kind === 'world-build') { if ((m as { event?: unknown }).event === 'attention' || (typeof m.rev === 'number' && m.rev > this.sites.maxRev)) this.sites.apply(m); continue; }
      if (m.kind !== 'world-diff' || typeof m.seq !== 'number' || m.seq <= this.seq) continue;
      this.stats.edgeSeen++;
      if (m.seq > this.seq + 1) { void this.resync(); return; }  // a gap: something was missed; take the whole picture again
      try { this.applyDiff(m as unknown as DiffMsg); this.stats.applied++; } catch (e) { this.stats.lastError = String(e); this.seq = m.seq; }
    }
  }
  private applyDiff(d: DiffMsg) {
    if (!this.model) return;
    {
      this.seq = d.seq;
      const held = this.sites.heldRemovals(d, this.model);
      this.sites.apply(d);
      for (const def of [...(d.defs ?? []), ...d.diff.defs]) { this.model.defs.set('sha:' + def.hash, def); this.model.defs.set(def.ref, def); if (def.ref.startsWith('core-')) this.model.defs.set('core/' + def.ref.slice(5), def); }
      for (const id of d.diff.removes) { this.model.delete(id); this.undraw(id, held.has(id) ? SITE_REFINEMENT.removalDelaySeconds : 0); }
      for (const e of d.diff.upserts) { if (this.model.entities.has(e.id)) this.model.delete(e.id); this.model.insert(e); }
      for (const e of d.diff.upserts) { const def = this.model.resolvedDef(e.def); if (def?.layer === 'solid') { try { this.model.index(e.id, this.model.footprint(e, def)); } catch { /* best effort */ } } }
      if ((d.diff as { constants?: WorldModel['constants'] }).constants) this.model.constants = (d.diff as { constants?: WorldModel['constants'] }).constants!;   // GOD-ENV: the world grew
      if (d.ground) { const grew = JSON.stringify(d.ground.extent) !== JSON.stringify(this.model.ground().extent); this.model.terrain = sameBase(this.model.ground(), d.ground) ? this.model.terrain.retile(d.ground, d.diff.tiles) : new Terrain(d.ground); this.rebuildTerrain(new Set(d.diff.tiles)); this.rebuildWater(); if (grew) this.buildHorizon(); }
      if (d.diff.world) { const before = JSON.stringify((this.model.state as { ground?: unknown }).ground ?? null); this.model.state = { ...this.model.state, ...d.diff.world } as WorldModel['state']; if (JSON.stringify((this.model.state as { ground?: unknown }).ground ?? null) !== before) this.rebuildTerrain(); }
      if (d.ground) this.sites.refreshAll(true); else this.sites.refitDiff(d);
      for (const e of d.diff.upserts) this.draw(e, true);
      // children ride with a moved parent: refresh their targets without easing
      const upserted = new Set(d.diff.upserts.map(e => e.id));
      for (const e of d.diff.upserts) for (const cid of this.model.subtree(e.id).slice(1)) { const c = this.model.entities.get(cid); if (c && !upserted.has(cid)) this.draw(c, false); }
      // a deck's rail opens where another thing's stair lands on it (gen-mesh deck/1): redraw decks when such a thing came or went
      const links = (e: Entity) => { const def = this.model!.resolvedDef(e.def); try { return !!def && !!this.model!.bake(def, e.params ?? {}, e.seed ?? 0, e.shape).links?.length; } catch { return false; } };
      if (d.diff.removes.length || d.diff.upserts.some(links)) for (const e of this.model.entities.values()) { const def = this.model.resolvedDef(e.def); if (!upserted.has(e.id) && def?.make.kind === 'gen' && def.make.gen === 'deck/1') this.draw(e, false, true); }
    }
  }

  /** E-life B7: god things that follow a native engine entity of the same name (a god balloon flying as its native ride,
   *  server god/rides.ts): world position from the recording, or none (back at its own pose). */
  private overrides = new Map<string, THREE.Vector3>();
  /** Names of world-level god things with a native ride twin: the god's balloons (def carrier + tag balloon). */
  rideNames(): string[] {
    if (!this.model) return [];
    const out: string[] = [];
    for (const e of this.model.entities.values()) { if (!e.name || e.in.parent !== 'world') continue; const def = this.model.resolvedDef(e.def) as (StoredDef & { components: Record<string, unknown> }) | undefined; if (def?.components.carrier && def.tags.includes('balloon')) out.push(e.name); }
    return out;
  }
  /** Draw the god thing named `name` where its native twin is (`p`: the recorded engine position), or at its own pose (null).
   *  It keeps its own height above the ground: drawn y = its own y + (recorded y − the ground at its home). */
  poseOverride(name: string, p: readonly [number, number, number] | null) {
    const e = this.model ? [...this.model.entities.values()].find((x) => x.name === name && x.in.parent === 'world') : undefined;
    if (!e) return;
    if (!p) { if (this.overrides.delete(e.id)) { const d = this.drawn.get(e.id); if (d) d.settled = false; } return; }
    const d = this.drawn.get(e.id); if (!d) return;
    const g = this.groundAt(d.to.p.x, d.to.p.z) ?? 0;
    const v = this.overrides.get(e.id) ?? new THREE.Vector3(); v.set(p[0], d.to.p.y + (p[1] - g), p[2]); this.overrides.set(e.id, v);
  }

  update(dt: number, nowMs: number, baseGround?: THREE.Object3D) {
    this.now = nowMs;
    if (!this.active) return;
    this.sites.update(nowMs);
    // W2b: fill old Eden's generated surface patterns (brick, ashlar, clapboard, tile, slate, turf blades) a few rows a
    // frame; until now only old Eden's own layer did, so entity worlds drew the flat placeholders. No-op once complete.
    stepSurfaceKit(2);
    if (this.horizon) this.horizon.visible = this.horizonBy.size === 0;
    if (nowMs - this.lastSeqCheck > 20_000 && this.signal) {  // cheap heartbeat: did we miss anything while the socket was down?
      this.lastSeqCheck = nowMs;
      // G8: a changed moderation veto also takes the whole (server-filtered) picture again
      void fetch(this.api('/v1/world/seq'), { signal: this.signal }).then((r) => (r.ok ? r.json() : null)).then((j: { seq: number; builds?: number; moderation?: { version?: unknown; hidden?: unknown } } | null) => { if (!this.signal?.aborted && j) { if (noteModeration(j.moderation) || j.seq !== this.seq) void this.resync(); else this.sites.checkRevision(j.builds); } }).catch(() => {});
    }
    // the entity terrain is the only ground: hide the native backdrop and the native floor planes (a flat
    // plane at y ≈ 0 would cover every pond, river and cut below it)
    if (baseGround) baseGround.traverse((o) => { if ((o.name === 'outside-ground' || o.name === 'commons-ground' || (o.parent === baseGround && (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry?.type === 'PlaneGeometry')) && !this.hiddenBase.has(o)) { o.visible = false; this.hiddenBase.add(o); } });
    for (const [id, d] of this.drawn) {
      const t = easeOut((nowMs - d.t0) / 1000 / d.dur);
      d.obj.position.lerpVectors(d.from.p, d.to.p, t);
      const ride = this.overrides.get(id); if (ride) d.obj.position.copy(ride);
      const s = d.from.s + (d.to.s - d.from.s) * t;
      d.obj.scale.setScalar(s);
      const shown = this.interiorVisible(id);
      const inHand = !d.removing && this.held.has(id) && this.handPoint(this.held.get(id)!, d.obj.position);
      if (d.inst) {
        if (d.removing && t >= 1) { this.instancer.remove(d.inst, id); this.drawn.delete(id); continue; }
        if (inHand || ride || !d.settled || shown !== (d.shown ?? true)) { this.instancer.set(d.inst, id, d.obj.position, d.obj.rotation.y, shown ? d.obj.scale.x : 0, [d.obj.rotation.x, d.obj.rotation.z]); d.shown = shown; if (t >= 1) d.settled = true; }
        continue;
      }
      d.obj.visible = shown;
      if (d.removing && t >= 1) { this.thingsGroup.remove(d.obj); disposeObject(d.obj); this.drawn.delete(id); continue; }
      if (d.motion && t >= 1 && !inHand) animate(d.obj, d.motion.entity, d.motion.def, nowMs / 1000, { y: ride ? ride.y : d.to.p.y, yaw: d.motion.yaw });
      if (ride) { d.obj.position.x = ride.x; d.obj.position.z = ride.z; }
    }
    void dt;
  }

  /** Viewer B7: where a body's figure holds a carried thing — the palm of its raised hand (the carrying arm is posed to
   *  the engine's hand point; the free one hangs lower), or between both palms when they are level (two-handed / seated).
   *  The figure is the native people view's rig, found in the scene by its name (= the body's engine id). False when the
   *  body has no figure here (no takes yet, or a stand-in): then the thing stays at the body entity's carry slot. */
  private handPoint(body: string, out: THREE.Vector3): boolean {
    let f = this.figures.get(body);
    if (f && 'holder' in f && !attached(f.holder)) f = undefined;
    if (!f || ('missingAt' in f && this.now - f.missingAt > 1000)) {
      let root: THREE.Object3D = this.group; while (root.parent) root = root.parent;
      let found: Figure = { missingAt: this.now };
      root.traverse((o) => {
        if ('holder' in found || o.name !== body) return;
        const bone = (n: string) => { let b: THREE.Object3D | null = null; o.traverse((c) => { if (!b && (c as THREE.Bone).isBone && c.name === n) b = c; }); return b as THREE.Object3D | null; };
        const wl = bone('WristL'), wr = bone('WristR');
        if (wl && wr) found = { holder: o, wrists: [wl, wr], knuckles: [bone('Middle2L'), bone('Middle2R')] };
      });
      this.figures.set(body, found); f = found;
    }
    if (!('holder' in f)) return false;
    f.holder.updateWorldMatrix(true, true);
    const palm = (k: 0 | 1, v: THREE.Vector3) => { f.wrists[k].getWorldPosition(v); const kn = f.knuckles[k]; if (kn) v.lerp(kn.getWorldPosition(_v3), 0.5); return v; };
    palm(0, _pl); palm(1, _pr);
    if (Math.abs(_pl.y - _pr.y) < 0.06) out.copy(_pl).lerp(_pr, 0.5); else out.copy(_pl.y > _pr.y ? _pl : _pr);
    return true;  // its base at the palm centre (a seated figure's palms rest on the thighs: lower would sink into them)
  }

  /** Interior view (building/1's mesh sets `userData.interior`): a thing on a storey its building hides is hidden too. */
  private interiorVisible(id: string): boolean {
    if (!this.model) return true;
    let e = this.model.entities.get(id), slot = e?.in.slot;
    for (let depth = 0; e && e.in.parent !== 'world' && depth < 6; depth++) {
      const host = this.drawn.get(e.in.parent)?.obj.userData.interior as { cut(): number; floorOf: Record<string, number> } | undefined;
      if (host) return (host.floorOf[slot ?? ''] ?? 0) <= host.cut();
      e = this.model.entities.get(e.in.parent); slot = e?.in.slot;
    }
    return true;
  }

  /** A box worth looking at first: the placed things if any, else the middle of the world. */
  viewBounds(): [number, number, number, number] {
    if (!this.model) return [-60, -60, 60, 60];
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const e of this.model.entities.values()) {
      if (e.in.parent !== 'world') continue;
      const d = this.model.resolvedDef(e.def); if (!d || d.components.landform || d.make.kind === 'gen' && (d.make.gen === 'landform/1' || d.make.gen === 'lake/1')) continue;
      if (e.shape && 'area' in e.shape) { for (const [x, z] of e.shape.area) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); } continue; }
      const wp = this.model.worldPose(e); x0 = Math.min(x0, wp.x - 10); z0 = Math.min(z0, wp.z - 10); x1 = Math.max(x1, wp.x + 10); z1 = Math.max(z1, wp.z + 10);
    }
    if (!Number.isFinite(x0)) { const h = Math.min(120, this.model.constants.extent / 4); return [-h, -h, h, h]; }
    return [x0, z0, x1, z1];
  }

  /** The world's own arrival spot: a top-level thing named `arrival` (Little Martians' flag at the Ceramic Commons), or null. */
  arrivalAt(): [number, number] | null {
    if (!this.model) return null;
    for (const e of this.model.entities.values()) if (e.name === 'arrival' && e.in.parent === 'world') { const wp = this.model.worldPose(e); return [wp.x, wp.z]; }
    return null;
  }

  /** Terrain meshes, for picking a ground point with a ray (flags). */
  terrainMeshes(): THREE.Object3D[] { return [...this.sectors.values()]; }

  /** Height for the camera clamp and anything else that asks; null outside the extent. */
  groundAt = (x: number, z: number): number | null => {
    if (!this.model) return null;
    const [bx0, bz0, bx1, bz1] = this.model.ground().extent;   // GOD-ENV: the world's bounds
    if (x < bx0 || x > bx1 || z < bz0 || z > bz1) return null;
    const y = this.model.terrain.sample(x, z);
    const w = waterLevel(this.model.ground(), x, z);
    return w !== null && w > y ? w : y;
  };

  dispose() {
    this.sites.dispose();
    this.instancer.dispose();
    this.cover.dispose();
    for (const m of this.sectors.values()) { m.geometry.dispose(); }
    this.sectors.clear();
    for (const d of this.drawn.values()) disposeObject(d.obj);
    this.drawn.clear();
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
    this.waterGroup.clear(); this.terrainGroup.clear(); this.thingsGroup.clear();
    if (this.horizon) { this.horizon.geometry.dispose(); (this.horizon.material as THREE.Material).dispose(); this.horizon = null; }
    this.active = false; this.model = null;
  }

  // ---------- terrain ----------

  private rebuildTerrain(onlyTiles?: Set<string>, deferMottle = false) {
    const m = this.model!; const [bx0, bz0, bx1, bz1] = m.ground().extent;   // GOD-ENV: bounds, a rectangle once extended
    const tx0 = Math.floor(bx0 / TILE_M), tx1 = Math.ceil(bx1 / TILE_M) - 1, tz0 = Math.floor(bz0 / TILE_M), tz1 = Math.ceil(bz1 / TILE_M) - 1;
    const sx0 = Math.floor(tx0 / SECTOR_TILES), sx1 = Math.floor(tx1 / SECTOR_TILES), sz0 = Math.floor(tz0 / SECTOR_TILES), sz1 = Math.floor(tz1 / SECTOR_TILES);
    const wanted = new Set<string>();
    for (let sz = sz0; sz <= sz1; sz++) for (let sx = sx0; sx <= sx1; sx++) {
      const key = `${sx},${sz}`; wanted.add(key);
      if (onlyTiles && this.sectors.has(key)) {
        let touched = false;
        for (const tk of onlyTiles) { const [tx, tz] = tk.split(',').map(Number); if (Math.floor(tx / SECTOR_TILES) === sx && Math.floor(tz / SECTOR_TILES) === sz) { touched = true; break; } }
        if (!touched) continue;
      }
      const old = this.sectors.get(key); if (old) { this.terrainGroup.remove(old); old.geometry.dispose(); }
      const mesh = this.sectorMesh(sx, sz, [tx0, tz0, tx1, tz1], deferMottle);
      this.sectors.set(key, mesh); this.terrainGroup.add(mesh);
    }
    for (const [key, mesh] of this.sectors) if (!wanted.has(key)) { this.terrainGroup.remove(mesh); mesh.geometry.dispose(); this.sectors.delete(key); }
    // things settle on the new ground: refresh poses of root entities (no easing)
    // lane PERF2: world builders (roads, areas, scatters that drape on the ground) are rebuilt only when their shape reaches a
    // re-baked tile; a hill raised in one corner no longer rebuilds every forest and road in the world
    if (onlyTiles) for (const e of m.entities.values()) if (e.in.parent === 'world') { const world = !!this.drawn.get(e.id)?.world; this.draw(e, false, world && reachesTiles(e, onlyTiles)); }
  }
  private sectorMesh(sx: number, sz: number, t: [number, number, number, number], deferMottle = false): THREE.Mesh {
    const m = this.model!;
    const tx0 = Math.max(t[0], sx * SECTOR_TILES), tz0 = Math.max(t[1], sz * SECTOR_TILES);
    const tx1 = Math.min(t[2], sx * SECTOR_TILES + SECTOR_TILES - 1), tz1 = Math.min(t[3], sz * SECTOR_TILES + SECTOR_TILES - 1);
    const x0 = tx0 * TILE_M, z0 = tz0 * TILE_M, w = (tx1 - tx0 + 1) * TILE_M, d = (tz1 - tz0 + 1) * TILE_M;
    const nx = w / TERRAIN_STEP, nz = d / TERRAIN_STEP;
    const pos = new Float32Array((nx + 1) * (nz + 1) * 3), col = new Float32Array((nx + 1) * (nz + 1) * 3);
    const c = new THREE.Color();
    const palette = (m.state as { ground?: { palette?: string } }).ground?.palette;
    const terrainColor = terrainColorFor(palette), deferred = deferMottle ? terrainColorDeferred(palette) : null;
    const nv = (nx + 1) * (nz + 1), rgb = deferred ? new Float64Array(nv * 3) : null, xz = deferred ? new Float64Array(nv * 2) : null, mottled: number[] = [];
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const x = x0 + i * TERRAIN_STEP, z = z0 + j * TERRAIN_STEP;
      const y = m.terrain.sample(Math.min(x, x0 + w - 1e-3), Math.min(z, z0 + d - 1e-3));
      const k = (j * (nx + 1) + i) * 3;
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
      const slope = m.terrain.slope(Math.min(x, x0 + w - 1e-3), Math.min(z, z0 + d - 1e-3));
      if (deferred) {   // the colour before the mottling now; the mottling (playa-mottle.ts) after, in a worker
        if (deferred(c, y, slope, m.constants.base)) mottled.push(k / 3);
        rgb![k] = c.r; rgb![k + 1] = c.g; rgb![k + 2] = c.b; xz![k / 3 * 2] = x; xz![k / 3 * 2 + 1] = z;
      } else terrainColor(c, y, slope, m.constants.base, x, z);
      col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
    }
    const idx: number[] = [];
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, cc = a + nx + 1, dd = cc + 1; idx.push(a, cc, b, b, cc, dd); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx); if (!computeVertexNormals(g)) g.computeVertexNormals();   // fast-geometry: same normals
    // Eden's meadow turf also takes the Eden realism ground shader (its own material, so a palette change never leaves it patched)
    const realism = groundRealismFor((m.state as { ground?: { palette?: string } }).ground?.palette);
    const mesh = new THREE.Mesh(g, this.material(realism ? 'terrain-meadow' : 'terrain', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: realism ? 1 : 0.95, metalness: 0 })));
    mesh.name = `entity-terrain ${sx},${sz}`; mesh.receiveShadow = true;
    if (deferred && mottled.length) {
      const key = `${sx},${sz}`, colour = g.attributes.color as THREE.BufferAttribute;
      mottleSector(rgb!, xz!, Uint32Array.from(mottled), col, (out) => {
        if (this.sectors.get(key) !== mesh && this.sectors.has(key)) return;   // replaced meanwhile: the new sector has its own
        if (out !== colour.array) (colour.array as Float32Array).set(out);
        colour.needsUpdate = true;
      });
    }
    if (realism) applyWorldRealism(mesh, { classify: () => 'ground' });
    return mesh;
  }
  private rebuildWater() {
    this.waterGroup.clear();
    const g = this.model!.ground();
    for (const w of g.waters) {
      // path water (rivers) is drawn by the river's own mesh half (per-point levels, flow, trimmed at lakes)
      if (w.path) continue;
      if (!w.area) continue;
      const shape = new THREE.Shape(w.area.map(([x, z]) => new THREE.Vector2(x, z)));
      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(Math.PI / 2); // Shape (x, y) → world (x, z); +y up handled by rotation
      // a hair below the level: where the ground around a pond is exactly at its level (a carve's rim) the water plane
      // was coplanar with the terrain and z-fought into a jagged edge near the camera; now the ground wins there
      geo.translate(0, w.level - WATER_SINK_M, 0);
      const mesh = waterMesh(geo, waterMaterial(), 'entity-water');
      this.waterGroup.add(mesh);
    }
    if (g.seaLevel !== undefined) {
      const [bx0, bz0, bx1, bz1] = g.extent, half = Math.max(bx1 - bx0, bz1 - bz0) / 2;
      const seaGeo = new THREE.PlaneGeometry(half * 8, half * 8); seaGeo.rotateX(-Math.PI / 2); seaGeo.translate((bx0 + bx1) / 2, g.seaLevel - WATER_SINK_M, (bz0 + bz1) / 2);
      const sea = waterMesh(seaGeo, waterMaterial(), 'entity-sea');
      this.waterGroup.add(sea);
    }
  }
  /** A ring of low hills beyond the extent so the edge of the world is a horizon, not a cliff. */
  private buildHorizon() {
    if (this.horizon) { this.group.remove(this.horizon); this.horizon.geometry.dispose(); }
    // GOD-ENV: round the world's bounds (a rectangle once extended): each spoke starts at the bounds' edge in its direction
    const m = this.model!; const [bx0, bz0, bx1, bz1] = m.ground().extent, cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2, hx = (bx1 - bx0) / 2, hz = (bz1 - bz0) / 2, half = Math.max(hx, hz);
    const edge = (a: number) => Math.min(Math.abs(Math.cos(a)) > 1e-6 ? hx / Math.abs(Math.cos(a)) : Infinity, Math.abs(Math.sin(a)) > 1e-6 ? hz / Math.abs(Math.sin(a)) : Infinity);
    const segs = 96, rings = 6;
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const c = new THREE.Color();
    const seed = hashSeed(m.seed);
    for (let r = 0; r <= rings; r++) for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2, d = edge(a), inner = d + half * 0.02, outer = d + half * 2.2, radius = inner + (outer - inner) * (r / rings);
      const f = r / rings, bump = Math.sin(a * 7 + seed) * 0.5 + Math.sin(a * 13 + seed * 1.7) * 0.3 + Math.sin(a * 29 + seed * 0.3) * 0.2;
      const h = r === 0 ? m.terrain.sample(cx + Math.cos(a) * (d - 1), cz + Math.sin(a) * (d - 1)) : m.constants.base + Math.max(0, bump) * half * 0.25 * Math.sin(Math.PI * f) + f * 8;
      pos.push(cx + Math.cos(a) * radius, h, cz + Math.sin(a) * radius);
      c.set(0x6f8f6a).lerp(new THREE.Color(0x9fb3c8), f * 0.9); col.push(c.r, c.g, c.b);
    }
    for (let r = 0; r < rings; r++) for (let s = 0; s < segs; s++) { const a = r * (segs + 1) + s, b = a + 1, cc = a + segs + 1, d = cc + 1; idx.push(a, b, cc, b, d, cc); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    this.horizon = new THREE.Mesh(g, this.material('horizon', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, fog: true })));
    this.horizon.name = 'entity-horizon'; this.horizon.userData.cameraTransparent = true;
    this.group.add(this.horizon);
  }

  // ---------- things ----------

  private draw(e: Entity, ease: boolean, force = false) {
    const m = this.model!; const def = m.resolvedDef(e.def);
    if (!def) return;
    if (def.tags.includes('horizon')) this.horizonBy.add(e.id); else this.horizonBy.delete(e.id);
    const parent = e.in.parent !== 'world' ? m.entities.get(e.in.parent) : undefined;
    if (parent && m.resolvedDef(parent.def)?.components.body) this.held.set(e.id, parent.id); else this.held.delete(e.id);
    const existing = this.drawn.get(e.id);
    const defHash = def.hash + ':' + JSON.stringify(e.params ?? {}) + ':' + JSON.stringify(e.state ?? {}) + ':' + JSON.stringify(e.shape ?? null) + ':' + JSON.stringify(e.r ?? 0);
    const builder = meshFor(def);
    const isWorld = !!builder?.world;
    const wp = m.worldPose(e);
    const target = isWorld ? new THREE.Vector3(0, 0, 0) : new THREE.Vector3(wp.x, wp.y, wp.z);
    const refinement = ease && !isWorld ? this.sites.refinement(e, m) : null;
    if (existing && existing.defHash === defHash && !existing.removing && !force) {
      if (isWorld) return;
      existing.obj.rotation.set(0, wp.yaw, 0); applyTilt(existing.obj, e);
      existing.from = refinement ? { p: target.clone(), s: wp.s * refinement.scale } : { p: ease ? existing.obj.position.clone() : target.clone(), s: ease ? existing.obj.scale.x : wp.s };
      existing.to = { p: target, s: wp.s }; existing.t0 = this.now; existing.dur = ease ? refinement?.seconds ?? EASE_IN_S : 0.001; existing.settled = false;
      return;
    }
    let built = this.build(e, def);
    if (!built) { if (existing) this.undraw(e.id); return; }
    if (existing) { if (existing.inst) this.instancer.remove(existing.inst, e.id); else { this.thingsGroup.remove(existing.obj); disposeObject(existing.obj); } this.drawn.delete(e.id); }
    // static things with an instance key share one InstancedMesh per part (a few draws for hundreds of props)
    const instKey = !isWorld && !hasMotion(def) && typeof built.userData.instanceKey === 'string' && instanceable(built) ? built.userData.instanceKey as string : undefined;
    if (instKey) { this.instancer.ensure(instKey, built); built = new THREE.Object3D(); }
    if (!isWorld) { built.rotation.set(0, wp.yaw, 0); applyTilt(built, e); }
    const fresh = !existing;
    const from = refinement ? { p: target.clone(), s: wp.s * refinement.scale } : fresh && ease ? { p: target.clone().add(new THREE.Vector3(0, DROP_M, 0)), s: wp.s * 0.2 } : { p: target.clone(), s: wp.s };
    built.position.copy(from.p); built.scale.setScalar(from.s);
    if (!instKey) this.thingsGroup.add(built);
    const to = { p: target, s: isWorld ? 1 : wp.s };
    if (isWorld) { from.s = fresh && ease ? 1 : 1; }
    this.drawn.set(e.id, { ...(instKey ? { inst: instKey, settled: false } : {}), obj: built, from, to, t0: this.now, dur: ease ? refinement?.seconds ?? EASE_IN_S : 0.001, defHash, world: isWorld, ...(hasMotion(def) ? { motion: { entity: e, def, yaw: wp.yaw } } : {}) });
  }
  private undraw(id: string, delaySeconds = 0) {
    this.held.delete(id); this.horizonBy.delete(id);
    const d = this.drawn.get(id); if (!d || d.removing) return;
    d.removing = true; d.settled = false; d.from = { p: d.obj.position.clone(), s: d.obj.scale.x }; d.to = { p: d.obj.position.clone().add(new THREE.Vector3(0, 2, 0)), s: 0.01 }; d.t0 = this.now + delaySeconds * 1000; d.dur = EASE_OUT_S;
  }
  /** One Object3D for an entity, from its def's mesh half (gen-mesh registry). Null when it has no picture (landforms, prefab roots, bodies). */
  private build(e: Entity, def: StoredDef): THREE.Object3D | null {
    const m = this.model!;
    if (def.make.kind === 'none' || def.make.kind === 'parts') return null;
    const builder = meshFor(def);
    if (!builder) return null;
    const params = paramsOf(e, def);
    const ctx: MeshCtx = {
      def, entity: e, params, args: def.make.kind === 'gen' ? ((def.make.args ?? {}) as Record<string, unknown>) : {},
      baked: m.bake(def, e.params ?? {}, e.seed ?? 0, e.shape), model: m, materials: this.lib,
      tint: (key, fallback) => { if (!key) return fallback; const v = params[key]; return typeof v === 'string' && /^#/.test(v) ? v : def.palette?.[key] ?? fallback; },
    };
    try { const obj = builder.build(ctx); if (obj) { obj.name ||= `entity ${e.name ?? e.id}`; const k = builder.instanceKey?.(ctx); if (k) obj.userData.instanceKey = `${def.make.kind === 'gen' ? def.make.gen : def.make.kind}|${k}`; } return obj; } catch (err) { this.stats.lastError = `${def.ref}: ${String(err)}`; return null; }
  }

  private material(key: string, make: () => THREE.Material) { let m = this.materials.get(key); if (!m) { m = make(); this.materials.set(key, m); } return m; }
}

const BUILD_SLICE_MS = 50;
/** An entity's mesh params: its generator's and def's defaults under its own params. */
function paramsOf(e: Entity, def: StoredDef): MeshCtx['params'] {
  const gen = def.make.kind === 'gen' ? GENERATORS[def.make.gen] : undefined;
  const defaults: Record<string, unknown> = {};
  for (const [k, f] of Object.entries({ ...(gen?.params ?? {}), ...def.params })) if ((f as { default?: unknown }).default !== undefined) defaults[k] = (f as { default?: unknown }).default;
  return { ...defaults, ...(e.params ?? {}) } as MeshCtx['params'];
}
/** Continue after every other queued task: at background priority where the browser has a task scheduler (Chrome: the
 *  socket's large join messages are read in many small tasks, each needing a turn), else after one message task. */
function nextTask(): Promise<void> {
  const sched = (globalThis as { scheduler?: { postTask?: (f: () => void, o: { priority: string }) => Promise<void> } }).scheduler;
  if (sched?.postTask) return sched.postTask(() => {}, { priority: 'background' });
  if (typeof MessageChannel === 'undefined') return new Promise((r) => setTimeout(r, 0));
  return new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => { ch.port1.close(); r(); }; ch.port2.postMessage(0); });
}
/** A cached snapshot (the server's snapshot cache or an edge copy, lanes W1/O2) says how old it is: its `now` is moved on by that. */
function ageNow(snap: { now?: number }, r: Response) { const age = Number(r.headers.get('age')) || 0; if (age > 0 && typeof snap.now === 'number') snap.now += age * 1000; }
const _pl = new THREE.Vector3(), _pr = new THREE.Vector3(), _v3 = new THREE.Vector3();
/** Still in a scene graph (a re-created figure leaves its old holder detached). */
function attached(o: THREE.Object3D): boolean { let p: THREE.Object3D | null = o; for (let i = 0; p && i < 64; i++) { if (p.type === 'Scene') return true; p = p.parent; } return false; }
/** Lane PERF2: two grounds differ only in landforms, waters or extent (what a world diff's tile list covers), so baked
 *  tiles outside that list stay valid. A change to anything else (base, noise) re-bakes everything. */
function reachesTiles(e: Entity, tiles: Set<string>): boolean {
  const sh = e.shape as { path?: [number, number][]; area?: [number, number][] } | undefined;
  const pts = sh?.area ?? sh?.path; if (!pts?.length) return true;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of pts) { if (x < x0) x0 = x; if (z < z0) z0 = z; if (x > x1) x1 = x; if (z > z1) z1 = z; }
  const pad = 16;   // road and river widths, verges and scatter jitter reach past the centre line
  for (const k of tiles) { const [tx, tz] = k.split(',').map(Number); if (tx * TILE_M <= x1 + pad && (tx + 1) * TILE_M >= x0 - pad && tz * TILE_M <= z1 + pad && (tz + 1) * TILE_M >= z0 - pad) return true; }
  return false;
}
function sameBase(a: Ground, b: Ground): boolean {
  const rest = (g: Ground) => JSON.stringify({ ...g, landforms: undefined, waters: undefined, extent: undefined, _ordered: undefined });
  return rest(a) === rest(b);
}
function applyTilt(obj: THREE.Object3D, e: Entity) { if (Array.isArray(e.r)) { obj.rotation.x = e.r[1]; obj.rotation.z = e.r[2]; } }
function disposeObject(o: THREE.Object3D) { o.traverse((c) => { const m = c as THREE.Mesh; if ((m as unknown as THREE.InstancedMesh).isInstancedMesh) (m as unknown as THREE.InstancedMesh).dispose(); }); }
const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);
const frac = (n: number) => { const x = Math.sin(n) * 43758.5453; return x - Math.floor(x); };
function hashSeed(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0) % 100000; }
function waterLevel(g: Ground, x: number, z: number): number | null {
  let level: number | null = null;
  for (const w of g.waters) if (w.area && pointInPoly(x, z, w.area)) level = w.level; else if (w.path && w.w) { const lv = waterLevelAt(g, x, z); if (lv !== null) level = lv; }
  return level ?? g.seaLevel ?? null;
}
// indexed reads, not array destructuring: the same arithmetic as @sim/ground's pointInPoly (L3e)
function pointInPoly(px: number, pz: number, poly: [number, number][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j], zi = a[1], zj = b[1];
    if ((zi > pz) !== (zj > pz)) { const xi = a[0]; if (px < ((b[0] - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside; }
  }
  return inside;
}
export type { Def };
export { TILE_N };
