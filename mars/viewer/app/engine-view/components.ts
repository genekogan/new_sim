// World components → meshes. One persistent mesh per entity; poses are
// snapshotted after every fixed tick and interpolated between the last two
// ticks (like humans.ts), so a carried beam moves with its carriers instead of
// snapping at tick rate. Orientation matches engine entityCorners(): roll about
// Z, then pitch about X, then yaw about Y = three Euler(pitch, -yaw, roll, 'YXZ'),
// local box origin at the base centre.
import * as THREE from 'three';
import type { Entity, WorldState } from '../../engine/world/types.ts';
import { def } from '../../engine/world/catalog.ts';

type Pose = { p: [number, number, number]; yaw: number; pitch: number; roll: number };
type View = { obj: THREE.Object3D; prev: Pose; cur: Pose; key: string };

const FALLBACK = '#d8b98a';
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpAngle = (a: number, b: number, t: number) => a + (((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * t;
const poseOf = (e: Entity): Pose => ({ p: [...e.pose.p], yaw: e.pose.yaw, pitch: e.pose.pitch ?? 0, roll: e.pose.roll ?? 0 });

export class ComponentViews {
  readonly group = new THREE.Group();
  private views = new Map<string, View>();
  private mats = new Map<string, THREE.MeshStandardMaterial>();
  private geos = new Map<string, THREE.BufferGeometry>();

  constructor() {
    this.group.name = 'engine components';
  }

  private mat(color: string) {
    let m = this.mats.get(color);
    if (!m) this.mats.set(color, (m = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: color === '#1f5fbf' || color === '#e86a1a' ? 0.25 : 0 })));
    return m;
  }

  private geo(key: string, make: () => THREE.BufferGeometry) {
    let g = this.geos.get(key);
    if (!g) this.geos.set(key, (g = make()));
    return g;
  }

  private mesh(g: THREE.BufferGeometry, color: string) {
    const m = new THREE.Mesh(g, this.mat(color));
    m.castShadow = m.receiveShadow = true;
    return m;
  }

  /** Object in the entity's local frame (origin at base centre). */
  private build(e: Entity): THREE.Object3D {
    const d = def(e.def);
    const [sx, sy, sz] = d.size;
    const color = d.color ?? FALLBACK;
    if (d.category === 'stair' && d.stair) return this.flight(e.def, sx, sy, sz, d.stair.treads, color);
    if (d.category === 'rack-upright') return this.upright(e.def, sx, sy, sz, color);
    return this.mesh(this.geo(`box:${e.def}`, () => new THREE.BoxGeometry(sx, sy, sz).translate(0, sy / 2, 0)), color);
  }

  /**
   * Upright = two columns (local x = ±depth/2) joined by diagonal bracing, the
   * whole thing inside the catalog box. Reads as the blue braced frame rather
   * than a solid slab, and makes pitch/lying orientation obvious.
   */
  private upright(id: string, depth: number, h: number, t: number, color: string) {
    const g = new THREE.Group();
    const col = this.geo(`col:${id}`, () => new THREE.BoxGeometry(t, h, t).translate(0, h / 2, 0));
    for (const s of [-1, 1]) {
      const m = this.mesh(col, color);
      m.position.x = (s * (depth - t)) / 2;
      g.add(m);
    }
    const inner = depth - t, bay = inner * 1.2; // brace panel height
    const n = Math.max(1, Math.round((h - 0.2) / bay));
    const step = (h - 0.2) / n;
    const len = Math.hypot(inner, step);
    const brace = this.geo(`brace:${id}:${n}`, () => new THREE.BoxGeometry(len, 0.03, t * 0.6));
    const rung = this.geo(`rung:${id}`, () => new THREE.BoxGeometry(inner, 0.035, t * 0.6));
    for (let i = 0; i < n; i++) {
      const b = this.mesh(brace, color);
      b.position.set(0, 0.1 + step * (i + 0.5), 0);
      b.rotation.z = (i % 2 ? 1 : -1) * Math.atan2(step, inner);
      g.add(b);
    }
    for (const y of [0.1, h - 0.1]) {
      const r = this.mesh(rung, color);
      r.position.y = y;
      g.add(r);
    }
    return g;
  }

  /**
   * Stair flight: two stringers whose top edges run through the tread tops
   * (tread i top at i·riser, centred at −run/2 + (i−½)·going; construction/stairs.ts).
   * Treads are separate entities and render as their own boxes.
   */
  private flight(id: string, run: number, rise: number, width: number, treads: number, color: string) {
    const g = new THREE.Group();
    const going = run / treads, riser = rise / (treads + 1);
    const top = (x: number) => riser * ((x + run / 2) / going + 0.5); // top-edge line through the tread tops
    const dv = 0.24 / Math.cos(Math.atan2(riser, going)); // 2x12 stringer depth, measured vertically
    const xg = (dv / riser - 0.5) * going - run / 2; // where the lower edge meets the ground
    const str = this.geo(`stringer:${id}`, () => {
      // level cut on the ground, plumb cut at the top; stays inside the catalog box
      const sh = new THREE.Shape([
        new THREE.Vector2(-run / 2, 0),
        new THREE.Vector2(-run / 2, top(-run / 2)),
        new THREE.Vector2(run / 2, top(run / 2)),
        new THREE.Vector2(run / 2, top(run / 2) - dv),
        new THREE.Vector2(xg, 0),
      ]);
      return new THREE.ExtrudeGeometry(sh, { depth: 0.04, bevelEnabled: false }).translate(0, 0, -0.02);
    });
    for (const s of [-1, 1]) {
      const m = this.mesh(str, color);
      m.position.z = (s * (width - 0.04)) / 2;
      g.add(m);
    }
    return g;
  }

  reset(world: Pick<WorldState, 'entities'>) {
    this.clear();
    this.onTick(world);
  }

  clear() {
    this.group.clear();
    this.views.clear();
  }

  /** Call after every engine tick (or with a sampled take frame, then `render(1)`). */
  onTick(world: Pick<WorldState, 'entities'>) {
    for (const e of Object.values(world.entities)) {
      if (e.kind !== 'component') continue;
      let v = this.views.get(e.id);
      if (!v || v.key !== e.def) {
        if (v) this.group.remove(v.obj);
        const obj = this.build(e);
        obj.name = e.id;
        this.group.add(obj);
        const p = poseOf(e);
        v = { obj, prev: p, cur: p, key: e.def };
        this.views.set(e.id, v);
        continue;
      }
      v.prev = v.cur;
      v.cur = poseOf(e);
    }
    for (const [id, v] of this.views)
      if (!world.entities[id]) {
        this.group.remove(v.obj);
        this.views.delete(id);
      }
  }

  /** alpha ∈ [0,1] = fraction of the next tick elapsed. */
  render(alpha: number) {
    for (const v of this.views.values()) {
      const a = v.prev, b = v.cur;
      v.obj.position.set(lerp(a.p[0], b.p[0], alpha), lerp(a.p[1], b.p[1], alpha), lerp(a.p[2], b.p[2], alpha));
      v.obj.rotation.set(lerpAngle(a.pitch, b.pitch, alpha), -lerpAngle(a.yaw, b.yaw, alpha), lerpAngle(a.roll, b.roll, alpha), 'YXZ');
    }
  }

  /**
   * Nearest point of an entity's catalog box (at its interpolated render pose) to a world point.
   * Used to put hands on the part a person grips. False when the entity is not drawn.
   */
  nearestPoint(id: string, world: THREE.Vector3, out: THREE.Vector3) {
    const v = this.views.get(id);
    if (!v) return false;
    const [sx, sy, sz] = def(v.key).size;
    v.obj.updateMatrixWorld();
    const l = v.obj.worldToLocal(out.copy(world));
    l.set(Math.min(sx / 2, Math.max(-sx / 2, l.x)), Math.min(sy, Math.max(0, l.y)), Math.min(sz / 2, Math.max(-sz / 2, l.z)));
    v.obj.localToWorld(l);
    return true;
  }

  /** World-space corners of an entity's rendered bounding box (tests: compare with engine entityCorners). */
  bounds(id: string) {
    const v = this.views.get(id);
    if (!v) return null;
    v.obj.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(v.obj);
    return { min: b.min.toArray(), max: b.max.toArray() };
  }

  dispose() {
    this.clear();
    for (const g of this.geos.values()) g.dispose();
    for (const m of this.mats.values()) m.dispose();
    this.geos.clear();
    this.mats.clear();
  }
}
