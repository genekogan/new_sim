// The entity world's picture (spec <eden4>/28 §8): terrain baked from the
// same ground recipe the server uses, water, a horizon ring, and one mesh per
// placed entity drawn from its def. Diffs arrive over the hub as
// `{type:'edge', kind:'world-diff'}`; new or moved things ease in over ~2.5 s.
// Inactive (and invisible) on worlds that have no entity layer.
import * as THREE from 'three';
import { TILE_M, TILE_N, Terrain, type Ground } from '@sim/ground';
import { WorldModel, scatterPoints, type Def, type Entity, type StoredDef } from '@sim/world-compiler';

type Snapshot = { contract: string; worldId: string; seq: number; counter?: number; seed?: string; constants: WorldModel['constants']; state: WorldModel['state']; ground: Ground; defs: StoredDef[]; entities: Entity[]; tiles: Record<string, string> };
type DiffMsg = { type: 'edge'; kind: 'world-diff'; seq: number; diff: { upserts: Entity[]; removes: string[]; defs: StoredDef[]; tiles: string[]; world?: Partial<WorldModel['state']> }; ground?: Ground };

const SECTOR_TILES = 4;              // 4×4 tiles (256 m) per terrain mesh
const TERRAIN_STEP = 2;              // metres between terrain vertices in the picture
const EASE_IN_S = 2.5, EASE_OUT_S = 0.6, DROP_M = 40;
const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

type Drawn = { obj: THREE.Object3D; from: { p: THREE.Vector3; s: number }; to: { p: THREE.Vector3; s: number }; t0: number; dur: number; removing?: boolean; defHash: string };

export class WorldEntityLayer {
  readonly group = new THREE.Group();
  active = false;
  private model: WorldModel | null = null;
  private seq = -1;
  private readonly terrainGroup = new THREE.Group();
  private readonly waterGroup = new THREE.Group();
  private readonly thingsGroup = new THREE.Group();
  private sectors = new Map<string, THREE.Mesh>();
  private drawn = new Map<string, Drawn>();
  private materials = new Map<string, THREE.Material>();
  private horizon: THREE.Mesh | null = null;
  private hiddenBase = new WeakSet<THREE.Object3D>();
  private now = 0;
  private readonly api: (p: string) => string;
  constructor(api: (p: string) => string) {
    this.api = api;
    this.group.name = 'entity-world';
    this.group.add(this.terrainGroup, this.waterGroup, this.thingsGroup);
  }

  async start(signal: AbortSignal) {
    let snap: Snapshot;
    try { const r = await fetch(this.api('/v1/world/snapshot'), { signal }); if (!r.ok) return; snap = await r.json(); } catch { return; }
    if (signal.aborted || snap.contract !== 'world/1') return;
    this.model = WorldModel.fromSnapshot({ constants: snap.constants, state: snap.state, seed: snap.seed ?? 'viewer', seq: snap.counter ?? 0, editSeq: snap.seq, defs: snap.defs, entities: snap.entities, ground: snap.ground });
    this.seq = snap.seq;
    this.active = true;
    this.rebuildTerrain();
    this.rebuildWater();
    this.buildHorizon();
    for (const e of snap.entities) this.draw(e, false);
  }

  /** Consume hub messages (the viewer keeps the last 300 edge messages; we only act on newer diffs). */
  applyEdge(msgs: readonly { type: string; kind?: string; seq?: unknown }[]) {
    if (!this.model) return;
    for (const m of msgs) {
      if (m.kind !== 'world-diff' || typeof m.seq !== 'number' || m.seq <= this.seq) continue;
      const d = m as unknown as DiffMsg;
      this.seq = d.seq;
      for (const def of d.diff.defs) { this.model.defs.set('sha:' + def.hash, def); this.model.defs.set(def.ref, def); if (def.ref.startsWith('core-')) this.model.defs.set('core/' + def.ref.slice(5), def); }
      for (const id of d.diff.removes) { this.model.delete(id); this.undraw(id); }
      for (const e of d.diff.upserts) { if (this.model.entities.has(e.id)) this.model.delete(e.id); this.model.insert(e); }
      if (d.ground) { this.model.terrain = new Terrain(d.ground); this.rebuildTerrain(new Set(d.diff.tiles)); this.rebuildWater(); }
      if (d.diff.world) this.model.state = { ...this.model.state, ...d.diff.world } as WorldModel['state'];
      for (const e of d.diff.upserts) this.draw(e, true);
      // children ride with a moved parent: refresh their targets without easing
      for (const e of d.diff.upserts) for (const cid of this.model.subtree(e.id).slice(1)) { const c = this.model.entities.get(cid); if (c) this.draw(c, false); }
    }
  }

  update(dt: number, nowMs: number, baseGround?: THREE.Object3D) {
    this.now = nowMs;
    if (!this.active) return;
    if (baseGround) baseGround.traverse((o) => { if (o.name === 'outside-ground' && !this.hiddenBase.has(o)) { o.visible = false; this.hiddenBase.add(o); } });
    for (const [id, d] of this.drawn) {
      const t = easeOut((nowMs - d.t0) / 1000 / d.dur);
      d.obj.position.lerpVectors(d.from.p, d.to.p, t);
      const s = d.from.s + (d.to.s - d.from.s) * t;
      d.obj.scale.setScalar(s);
      if (d.removing && t >= 1) { this.thingsGroup.remove(d.obj); disposeObject(d.obj); this.drawn.delete(id); }
    }
    void dt;
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

  /** Height for the camera clamp and anything else that asks; null outside the extent. */
  groundAt = (x: number, z: number): number | null => {
    if (!this.model) return null;
    const half = this.model.constants.extent / 2;
    if (Math.abs(x) > half || Math.abs(z) > half) return null;
    const y = this.model.terrain.sample(x, z);
    const w = waterLevel(this.model.ground(), x, z);
    return w !== null && w > y ? w : y;
  };

  dispose() {
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

  private rebuildTerrain(onlyTiles?: Set<string>) {
    const m = this.model!; const half = m.constants.extent / 2;
    const t0 = Math.floor(-half / TILE_M), t1 = Math.ceil(half / TILE_M) - 1;
    const s0 = Math.floor(t0 / SECTOR_TILES), s1 = Math.floor(t1 / SECTOR_TILES);
    const wanted = new Set<string>();
    for (let sz = s0; sz <= s1; sz++) for (let sx = s0; sx <= s1; sx++) {
      const key = `${sx},${sz}`; wanted.add(key);
      if (onlyTiles && this.sectors.has(key)) {
        let touched = false;
        for (const tk of onlyTiles) { const [tx, tz] = tk.split(',').map(Number); if (Math.floor(tx / SECTOR_TILES) === sx && Math.floor(tz / SECTOR_TILES) === sz) { touched = true; break; } }
        if (!touched) continue;
      }
      const old = this.sectors.get(key); if (old) { this.terrainGroup.remove(old); old.geometry.dispose(); }
      const mesh = this.sectorMesh(sx, sz, t0, t1);
      this.sectors.set(key, mesh); this.terrainGroup.add(mesh);
    }
    for (const [key, mesh] of this.sectors) if (!wanted.has(key)) { this.terrainGroup.remove(mesh); mesh.geometry.dispose(); this.sectors.delete(key); }
    // things settle on the new ground: refresh poses of root entities (no easing)
    if (onlyTiles) for (const e of m.entities.values()) if (e.in.parent === 'world') this.draw(e, false);
  }
  private sectorMesh(sx: number, sz: number, t0: number, t1: number): THREE.Mesh {
    const m = this.model!;
    const tx0 = Math.max(t0, sx * SECTOR_TILES), tz0 = Math.max(t0, sz * SECTOR_TILES);
    const tx1 = Math.min(t1, sx * SECTOR_TILES + SECTOR_TILES - 1), tz1 = Math.min(t1, sz * SECTOR_TILES + SECTOR_TILES - 1);
    const x0 = tx0 * TILE_M, z0 = tz0 * TILE_M, w = (tx1 - tx0 + 1) * TILE_M, d = (tz1 - tz0 + 1) * TILE_M;
    const nx = w / TERRAIN_STEP, nz = d / TERRAIN_STEP;
    const pos = new Float32Array((nx + 1) * (nz + 1) * 3), col = new Float32Array((nx + 1) * (nz + 1) * 3);
    const c = new THREE.Color();
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const x = x0 + i * TERRAIN_STEP, z = z0 + j * TERRAIN_STEP;
      const y = m.terrain.sample(Math.min(x, x0 + w - 1e-3), Math.min(z, z0 + d - 1e-3));
      const k = (j * (nx + 1) + i) * 3;
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
      const slope = m.terrain.slope(Math.min(x, x0 + w - 1e-3), Math.min(z, z0 + d - 1e-3));
      terrainColor(c, y, slope, m.constants.base);
      col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
    }
    const idx: number[] = [];
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, cc = a + nx + 1, dd = cc + 1; idx.push(a, cc, b, b, cc, dd); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, this.material('terrain', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })));
    mesh.name = `entity-terrain ${sx},${sz}`; mesh.receiveShadow = true;
    return mesh;
  }
  private rebuildWater() {
    this.waterGroup.clear();
    const g = this.model!.ground();
    for (const w of g.waters) {
      if (!w.area) continue;
      const shape = new THREE.Shape(w.area.map(([x, z]) => new THREE.Vector2(x, z)));
      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(Math.PI / 2); // Shape (x, y) → world (x, z); +y up handled by rotation
      const mesh = new THREE.Mesh(geo, this.material('water', () => new THREE.MeshStandardMaterial({ color: 0x3a7ca8, transparent: true, opacity: 0.78, roughness: 0.25, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false })));
      mesh.position.y = w.level; mesh.name = 'entity-water'; mesh.userData.cameraTransparent = true;
      // ShapeGeometry's rotateX maps shape y → -z; flip to match world z
      mesh.scale.z = -1;
      this.waterGroup.add(mesh);
    }
    if (g.seaLevel !== undefined) {
      const half = this.model!.constants.extent / 2;
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(half * 8, half * 8), this.material('water', () => new THREE.MeshStandardMaterial({ color: 0x3a7ca8, transparent: true, opacity: 0.78, roughness: 0.25, side: THREE.DoubleSide, depthWrite: false })));
      sea.rotation.x = -Math.PI / 2; sea.position.y = g.seaLevel; sea.name = 'entity-sea'; sea.userData.cameraTransparent = true;
      this.waterGroup.add(sea);
    }
  }
  /** A ring of low hills beyond the extent so the edge of the world is a horizon, not a cliff. */
  private buildHorizon() {
    if (this.horizon) { this.group.remove(this.horizon); this.horizon.geometry.dispose(); }
    const m = this.model!; const half = m.constants.extent / 2;
    const inner = half * 1.02, outer = half * 3.2, segs = 96, rings = 6;
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const c = new THREE.Color();
    const seed = hashSeed(m.seed);
    for (let r = 0; r <= rings; r++) for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2, radius = inner + (outer - inner) * (r / rings);
      const f = r / rings, bump = Math.sin(a * 7 + seed) * 0.5 + Math.sin(a * 13 + seed * 1.7) * 0.3 + Math.sin(a * 29 + seed * 0.3) * 0.2;
      const h = r === 0 ? m.terrain.sample(Math.cos(a) * (half - 1), Math.sin(a) * (half - 1)) : m.constants.base + Math.max(0, bump) * half * 0.25 * Math.sin(Math.PI * f) + f * 8;
      pos.push(Math.cos(a) * radius, h, Math.sin(a) * radius);
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

  private draw(e: Entity, ease: boolean) {
    const m = this.model!; const def = m.resolvedDef(e.def);
    if (!def) return;
    const built = this.build(e, def);
    const wp = m.worldPose(e);
    const target = new THREE.Vector3(wp.x, wp.y, wp.z);
    const existing = this.drawn.get(e.id);
    if (!built) { if (existing) this.undraw(e.id); return; }
    const defHash = def.hash + ':' + JSON.stringify(e.params ?? {}) + ':' + JSON.stringify(e.state ?? {}) + ':' + JSON.stringify(e.shape ?? null);
    if (existing && existing.defHash === defHash && !existing.removing) {
      existing.obj.rotation.set(0, wp.yaw, 0); applyTilt(existing.obj, e);
      existing.from = { p: ease ? existing.obj.position.clone() : target.clone(), s: ease ? existing.obj.scale.x : wp.s };
      existing.to = { p: target, s: wp.s }; existing.t0 = this.now; existing.dur = ease ? EASE_IN_S : 0.001;
      return;
    }
    if (existing) { this.thingsGroup.remove(existing.obj); disposeObject(existing.obj); this.drawn.delete(e.id); }
    built.rotation.set(0, wp.yaw, 0); applyTilt(built, e);
    const fresh = !existing;
    const from = fresh && ease ? { p: target.clone().add(new THREE.Vector3(0, DROP_M, 0)), s: wp.s * 0.2 } : { p: target.clone(), s: wp.s };
    built.position.copy(from.p); built.scale.setScalar(from.s);
    this.thingsGroup.add(built);
    this.drawn.set(e.id, { obj: built, from, to: { p: target, s: wp.s }, t0: this.now, dur: ease ? EASE_IN_S : 0.001, defHash });
  }
  private undraw(id: string) {
    const d = this.drawn.get(id); if (!d || d.removing) return;
    d.removing = true; d.from = { p: d.obj.position.clone(), s: d.obj.scale.x }; d.to = { p: d.obj.position.clone().add(new THREE.Vector3(0, 2, 0)), s: 0.01 }; d.t0 = this.now; d.dur = EASE_OUT_S;
  }
  /** One Object3D for an entity, from its def. Null when the thing has no picture of its own (landforms, prefab roots, bodies). */
  private build(e: Entity, def: StoredDef): THREE.Object3D | null {
    const m = this.model!;
    const params = e.params ?? {};
    if (def.make.kind === 'none' || def.make.kind === 'parts') return null;
    if (def.make.kind === 'gen') {
      switch (def.make.gen) {
        case 'landform/1': case 'lake/1': return null;
        case 'scatter/1': return this.scatter(e, def);
        case 'box/1': default: {
          const w = num(params.w, def.size.box[0]), h = num(params.h, def.size.box[1]), d = num(params.d, def.size.box[2]);
          const color = typeof e.state?.paint === 'string' ? e.state.paint : typeof params.color === 'string' ? params.color : '#9a9a9a';
          const mesh = new THREE.Mesh(this.box(), this.material('std:' + color, () => new THREE.MeshStandardMaterial({ color, roughness: 0.85 })));
          mesh.scale.set(w, h, d); mesh.position.y = h / 2;
          mesh.castShadow = true; mesh.receiveShadow = true;
          const holder = new THREE.Group(); holder.add(mesh); holder.name = `entity ${e.name ?? e.id}`;
          if (def.tags.includes('tree')) { // a quick canopy so trees read as trees until M5's generator
            const canopy = new THREE.Mesh(this.sphere(), this.material('std:#3f7d3a', () => new THREE.MeshStandardMaterial({ color: '#3f7d3a', roughness: 0.9 })));
            canopy.scale.set(w * 5, h * 0.55, d * 5); canopy.position.y = h * 0.8; canopy.castShadow = true; holder.add(canopy);
          }
          return holder;
        }
      }
    }
    // mesh defs: a placeholder box until the asset pipeline (M5) streams GLBs
    const [w, h, d] = def.size.box;
    const mesh = new THREE.Mesh(this.box(), this.material('std:#b0a090', () => new THREE.MeshStandardMaterial({ color: '#b0a090', roughness: 0.8 })));
    mesh.scale.set(w, h, d); mesh.position.y = h / 2; mesh.castShadow = true;
    void m;
    return mesh;
  }
  private scatter(e: Entity, def: StoredDef): THREE.Object3D | null {
    const m = this.model!; const params = e.params ?? {};
    if (!e.shape || !('area' in e.shape)) return null;
    const density = num(params.density, 0.05), spacing = num(params.minSpacing, 2), height = num(params.height, def.tags.includes('garden') ? 0.5 : 6);
    const pts = scatterPoints(e.shape.area, density, spacing, e.seed ?? hashSeed(e.id), 3000);
    if (!pts.length) return null;
    const forest = def.name.includes('forest') || height >= 3;
    const holder = new THREE.Group(); holder.name = `scatter ${e.name ?? e.id}`;
    const dummy = new THREE.Object3D();
    if (forest) {
      const trunks = new THREE.InstancedMesh(this.box(), this.material('std:#5a3d22', () => new THREE.MeshStandardMaterial({ color: '#5a3d22', roughness: 0.9 })), pts.length);
      const crowns = new THREE.InstancedMesh(this.cone(), this.material('std:#2f6b2f', () => new THREE.MeshStandardMaterial({ color: '#2f6b2f', roughness: 0.9 })), pts.length);
      pts.forEach(([x, z], i) => {
        const y = m.terrain.sample(x, z), h = height * (0.7 + 0.6 * frac(i * 7919 + (e.seed ?? 0)));
        dummy.position.set(x, y + h * 0.25, z); dummy.scale.set(0.3, h * 0.5, 0.3); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
        dummy.position.set(x, y + h * 0.5 + h * 0.3, z); dummy.scale.set(h * 0.35, h * 0.6, h * 0.35); dummy.updateMatrix(); crowns.setMatrixAt(i, dummy.matrix);
      });
      trunks.castShadow = crowns.castShadow = true; trunks.instanceMatrix.needsUpdate = crowns.instanceMatrix.needsUpdate = true;
      holder.add(trunks, crowns);
    } else {
      const color = def.tags.includes('garden') ? '#c75c7a' : '#7fb24a';
      const tufts = new THREE.InstancedMesh(this.cone(), this.material('std:' + color, () => new THREE.MeshStandardMaterial({ color, roughness: 1 })), pts.length);
      pts.forEach(([x, z], i) => { const y = m.terrain.sample(x, z), h = height * (0.6 + 0.8 * frac(i * 104729 + (e.seed ?? 0))); dummy.position.set(x, y + h / 2, z); dummy.scale.set(h * 0.5, h, h * 0.5); dummy.rotation.set(0, frac(i * 31) * 6.28, 0); dummy.updateMatrix(); tufts.setMatrixAt(i, dummy.matrix); });
      tufts.instanceMatrix.needsUpdate = true; holder.add(tufts);
    }
    return holder;
  }

  private _box?: THREE.BoxGeometry; private _sphere?: THREE.SphereGeometry; private _cone?: THREE.ConeGeometry;
  private box() { return (this._box ??= new THREE.BoxGeometry(1, 1, 1)); }
  private sphere() { return (this._sphere ??= new THREE.SphereGeometry(0.5, 10, 7)); }
  private cone() { return (this._cone ??= new THREE.ConeGeometry(0.5, 1, 7)); }
  private material(key: string, make: () => THREE.Material) { let m = this.materials.get(key); if (!m) { m = make(); this.materials.set(key, m); } return m; }
}

function applyTilt(obj: THREE.Object3D, e: Entity) { if (Array.isArray(e.r)) { obj.rotation.x = e.r[1]; obj.rotation.z = e.r[2]; } }
function disposeObject(o: THREE.Object3D) { o.traverse((c) => { const m = c as THREE.Mesh; if ((m as unknown as THREE.InstancedMesh).isInstancedMesh) (m as unknown as THREE.InstancedMesh).dispose(); }); }
const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);
const frac = (n: number) => { const x = Math.sin(n) * 43758.5453; return x - Math.floor(x); };
function hashSeed(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0) % 100000; }
function terrainColor(c: THREE.Color, y: number, slope: number, base: number) {
  const h = y - base;
  if (slope > 0.9 || h > 120) c.set(0x8d8a84);        // rock
  else if (h > 70) c.set(0x7e8a6e);                     // high meadow
  else if (slope > 0.5) c.set(0x7a8d5e);                // steep grass
  else if (h < -0.2) c.set(0xa89b6f);                   // lake bed / sand
  else c.set(0x5f9a4c);                                  // grass
  if (h > 150) c.lerp(new THREE.Color(0xf2f4f6), Math.min(1, (h - 150) / 40)); // snow
}
function waterLevel(g: Ground, x: number, z: number): number | null {
  let level: number | null = null;
  for (const w of g.waters) if (w.area && pointInPoly(x, z, w.area)) level = w.level;
  return level ?? g.seaLevel ?? null;
}
function pointInPoly(px: number, pz: number, poly: [number, number][]) { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside; } return inside; }
export type { Def };
export { TILE_N };
