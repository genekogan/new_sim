// World fixtures (kind 'fixture': benches, camp chairs, campfires; engine/world/catalog.ts
// SOCIAL_FIXTURES) → simple meshes inside each catalog box, local origin at the base centre,
// seats facing local +z (rotation.y = −yaw, as for components). Renderers only read the world.
// A campfire gets a flame and ember glow; after dusk (`setDusk(true)`) the flame brightens and a
// warm point light comes on. Fixtures do not move, so there is no tick interpolation.
import * as THREE from 'three';
import type { Entity, WorldState } from '../../engine/world/types.ts';
import { CATALOG } from '../../engine/world/catalog.ts';

type View = { obj: THREE.Object3D; key: string; flame?: THREE.Mesh; light?: THREE.PointLight };

/** Top of the camp chair's fabric seat (m), as built by `chair()`. */
const CHAIR_SEAT = 0.44;
/** Height of the sitting surface of a seat fixture as drawn here (humans.ts lowers sitters onto it). */
export function seatHeight(def: string): number | undefined {
  if (def === 'camp-chair') return CHAIR_SEAT;
  if (def === 'bench-6ft') return CATALOG[def]?.size[1]; // plank top = box height
  return undefined;
}

export class FixtureViews {
  readonly group = new THREE.Group();
  private views = new Map<string, View>();
  private dusk = false;
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats = new Map<string, THREE.Material>();
  private readonly unit = this.keep(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));

  constructor() {
    this.group.name = 'engine fixtures';
  }

  private keep<T extends THREE.BufferGeometry>(g: T): T {
    this.geos.push(g);
    return g;
  }

  private mat(key: string, make: () => THREE.Material) {
    let m = this.mats.get(key);
    if (!m) this.mats.set(key, (m = make()));
    return m;
  }
  private std(color: string, roughness = 0.85, metalness = 0) {
    return this.mat(`std:${color}:${metalness}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  }

  /** Box with its base at y0 in the fixture's local frame. */
  private box(color: string, cx: number, y0: number, cz: number, sx: number, sy: number, sz: number, metal = 0) {
    const m = new THREE.Mesh(this.unit, this.std(color, metal ? 0.5 : 0.85, metal));
    m.scale.set(sx, sy, sz);
    m.position.set(cx, y0, cz);
    m.castShadow = m.receiveShadow = true;
    return m;
  }

  /** Plank seat on two end slabs, inside the 6 ft × 0.45 × 0.4 m box. */
  private bench(sx: number, sy: number, sz: number, color: string) {
    const g = new THREE.Group();
    g.add(this.box(color, 0, sy - 0.05, 0, sx, 0.05, sz));
    for (const s of [-1, 1]) g.add(this.box(color, s * (sx / 2 - 0.12), 0, 0, 0.05, sy - 0.05, sz * 0.85));
    return g;
  }

  /** Folding camp chair: fabric seat at 0.42 m, fabric back on the −z side (the sitter faces +z), metal legs. */
  private chair(sx: number, sy: number, sz: number, color: string) {
    const g = new THREE.Group();
    const leg = '#3a3f44';
    g.add(this.box(color, 0, CHAIR_SEAT - 0.04, 0.02, sx - 0.06, 0.04, sz - 0.1));
    const back = this.box(color, 0, 0, 0, sx - 0.06, sy - 0.44, 0.03);
    back.position.set(0, 0.42, -sz / 2 + 0.05);
    back.rotation.x = -0.18; // leaning back
    g.add(back);
    for (const x of [-1, 1]) for (const z of [-1, 1]) g.add(this.box(leg, (x * (sx - 0.06)) / 2, 0, (z * (sz - 0.08)) / 2, 0.025, 0.42, 0.025, 0.3));
    for (const x of [-1, 1]) g.add(this.box(leg, (x * (sx - 0.02)) / 2, 0.58, 0.02, 0.03, 0.03, sz - 0.12, 0.3)); // armrests
    return g;
  }

  /** Stone ring, crossed logs, a flame cone and an ember disc; the point light is lit after dusk. */
  private campfire(sx: number, sy: number, v: Partial<View>) {
    const g = new THREE.Group();
    const r = sx / 2 - 0.1, n = 11;
    const stone = this.keep(new THREE.DodecahedronGeometry(0.1, 0));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const m = new THREE.Mesh(stone, this.std('#77716a', 1));
      m.position.set(Math.cos(a) * r, 0.07, Math.sin(a) * r);
      m.scale.set(1.1, 0.8 + 0.3 * ((k * 7) % 3) / 2, 1);
      m.rotation.set(k, k * 2, 0);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    }
    const log = this.keep(new THREE.CylinderGeometry(0.05, 0.06, r * 1.5, 7).rotateZ(Math.PI / 2));
    for (const a of [0.4, -0.5, 1.6]) {
      const m = new THREE.Mesh(log, this.std('#4a2e1a', 1));
      m.position.y = 0.08;
      m.rotation.y = a;
      m.castShadow = true;
      g.add(m);
    }
    const embers = new THREE.Mesh(this.keep(new THREE.CircleGeometry(r * 0.8, 20).rotateX(-Math.PI / 2)), this.mat('embers', () => new THREE.MeshBasicMaterial({ color: '#ff5a1a', transparent: true, opacity: 0.85 })));
    embers.position.y = 0.02;
    g.add(embers);
    const flame = new THREE.Mesh(
      this.keep(new THREE.ConeGeometry(0.2, Math.max(0.5, sy * 1.8), 9, 1, true).translate(0, Math.max(0.5, sy * 1.8) / 2, 0)),
      new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    flame.position.y = 0.06;
    flame.name = 'flame';
    g.add(flame);
    const light = new THREE.PointLight('#ff9a4a', 0, 11, 1.6);
    light.position.y = 0.7;
    g.add(light);
    v.flame = flame;
    v.light = light;
    return g;
  }

  private build(e: Entity): View {
    const d = CATALOG[e.def];
    const [sx, sy, sz] = d?.size ?? [0.5, 0.5, 0.5];
    const color = d?.color ?? '#b08a5a';
    const v: Partial<View> = { key: e.def };
    let obj: THREE.Object3D;
    if (e.def === 'bench-6ft') obj = this.bench(sx, sy, sz, color);
    else if (e.def === 'camp-chair') obj = this.chair(sx, sy, sz, color);
    else if (e.def === 'campfire') obj = this.campfire(sx, sy, v);
    else obj = this.box(color, 0, 0, 0, sx, sy, sz);
    obj.name = e.id;
    v.obj = obj;
    return v as View;
  }

  /** Dusk: the fire's light comes on and its flame brightens. */
  setDusk(on: boolean) {
    this.dusk = on;
    for (const v of this.views.values()) this.applyDusk(v);
  }

  private applyDusk(v: View) {
    if (v.light) v.light.intensity = this.dusk ? 9 : 0;
    if (v.flame) (v.flame.material as THREE.MeshBasicMaterial).opacity = this.dusk ? 0.95 : 0.55;
  }

  reset(world: Pick<WorldState, 'entities'>) {
    this.clear();
    this.onTick(world);
  }

  clear() {
    for (const v of this.views.values()) (v.flame?.material as THREE.Material | undefined)?.dispose();
    this.group.clear();
    this.views.clear();
  }

  /** Create/remove fixture meshes to match the world and copy their poses. */
  onTick(world: Pick<WorldState, 'entities'>) {
    for (const e of Object.values(world.entities)) {
      if (e.kind !== 'fixture') continue;
      let v = this.views.get(e.id);
      if (!v || v.key !== e.def) {
        if (v) this.group.remove(v.obj);
        v = this.build(e);
        this.views.set(e.id, v);
        this.group.add(v.obj);
        this.applyDusk(v);
      }
      v.obj.position.set(e.pose.p[0], e.pose.p[1], e.pose.p[2]);
      v.obj.rotation.set(0, -e.pose.yaw, 0);
    }
    for (const [id, v] of this.views)
      if (!world.entities[id]) {
        this.group.remove(v.obj);
        this.views.delete(id);
      }
  }

  /** Flicker the flames (deterministic in `t`, seconds of sim time). */
  render(t: number) {
    for (const v of this.views.values()) {
      if (!v.flame) continue;
      const f = 1 + 0.12 * Math.sin(t * 11.3) + 0.07 * Math.sin(t * 23.7 + 1.3);
      v.flame.scale.set(1 / Math.sqrt(f), f, 1 / Math.sqrt(f));
      if (v.light && this.dusk) v.light.intensity = 9 * (0.9 + 0.1 * f);
    }
  }

  dispose() {
    this.clear();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats.values()) m.dispose();
    this.mats.clear();
  }
}
