// World fixtures (kind 'fixture': benches, camp chairs, campfires; engine/world/catalog.ts
// SOCIAL_FIXTURES) → simple meshes inside each catalog box, local origin at the base centre,
// seats facing local +z (rotation.y = −yaw, as for components). Renderers only read the world.
// A campfire gets the animated fire of fire.ts (seeded by the entity id, driven by sim time); after
// dusk (`setDusk(true)`) the flames brighten and its flickering warm point light comes on. Fixtures do
// not move, so there is no tick interpolation.
import * as THREE from 'three';
import type { Entity, WorldState } from '../../engine/world/types.ts';
import { CATALOG } from '../../engine/world/catalog.ts';
import { BUNDLES } from '../../engine/world/catalog-stock.ts';
import { createFire, seedOf, type Fire } from './fire.ts';
import { tableObject } from './items.ts';

/** A bundle / stack's pieces (rebuilt when `contents.count` changes). */
type Stack = { group: THREE.Group; count: number };
type Screen = { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; material: THREE.MeshBasicMaterial; key: string };
type View = { obj: THREE.Object3D; key: string; fire?: Fire; stack?: Stack; screen?: Screen };

/** Dunnage under a bundle (catalog-stock.ts: 0.1 m runners). */
const DUNNAGE = 0.1;
const STRAP = '#1d1f22';
/** Pieces left in a bundle entity (contents.count; else the fraction of its capacity). */
export function bundleCount(e: Entity): number | null {
  const b = BUNDLES[e.def];
  if (!b) return null;
  const c = e.contents as { count?: number; fraction?: number } | undefined;
  if (typeof c?.count === 'number') return c.count;
  return Math.round((c?.fraction ?? 1) * b.capacity);
}

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

  /** Stone ring, crossed logs and the animated fire (coal bed, flames, embers, smoke, flickering light). */
  private campfire(id: string, sx: number, v: Partial<View>) {
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
    const fire = createFire(seedOf(id), r * 0.85, { intensity: 9, distance: 11, decay: 1.6, y: 0.7 });
    g.add(fire.group);
    v.fire = fire;
    return g;
  }

  /** Freestanding frame with a front (+z) screen inside its catalog box. */
  private standingDisplay(sx: number, sy: number, sz: number, v: Partial<View>) {
    const g = new THREE.Group();
    g.add(this.box('#343a40', 0, 0, 0, sx * 0.48, 0.06, sz));
    g.add(this.box('#565d62', 0, 0, 0, 0.06, sy * 0.35, 0.06, 0.5));
    g.add(this.box('#1a222d', 0, sy * 0.36, 0, sx, sy * 0.64, sz * 0.55, 0.2));
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 288;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
    const panel = new THREE.Mesh(this.keep(new THREE.PlaneGeometry(sx - 0.12, sy * 0.64 - 0.1)), material);
    panel.position.set(0, sy * 0.68, sz * 0.29);
    g.add(panel);
    v.screen = { canvas, texture, material, key: '' };
    return g;
  }

  private drawScreen(e: Entity, screen: Screen) {
    const c = e.equipment?.kind === 'display' ? e.equipment.config : {};
    const on = c.mode === 'on' && c.available !== false;
    const content = typeof c.content === 'string' ? c.content : '';
    const key = `${on}:${content}`;
    if (key === screen.key) return;
    screen.key = key;
    const ctx = screen.canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = on ? '#d9e6e3' : '#15212a';
    ctx.fillRect(0, 0, 512, 288);
    if (on) {
      ctx.fillStyle = '#183c4d';
      ctx.font = 'bold 29px sans-serif';
      const words = content.split(/\s+/).filter(Boolean);
      let line = '', y = 75;
      for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (ctx.measureText(next).width > 450 && line) { ctx.fillText(line, 30, y); y += 38; line = word; }
        else line = next;
        if (y > 245) break;
      }
      if (line && y <= 245) ctx.fillText(line, 30, y);
      if (!content) { ctx.fillStyle = '#4d918d'; ctx.fillRect(30, 136, 450, 8); }
    }
    screen.texture.needsUpdate = true;
  }

  private lectern(sx: number, sy: number, sz: number) {
    const g = new THREE.Group();
    g.add(this.box('#73583f', 0, 0, 0, sx * 0.85, sy * 0.77, sz * 0.65));
    g.add(this.box('#a57b4e', 0, sy * 0.77, 0, sx, sy * 0.06, sz));
    g.add(this.box('#6a4c36', 0, sy * 0.83, sz * 0.42, sx, sy * 0.17, sz * 0.12));
    return g;
  }

  /**
   * A strapped bundle / stack (catalog-stock.ts BUNDLES): two dunnage runners, the pieces left and dark
   * straps round them. The catalog box is the full stack; what is drawn is `count` pieces, so the
   * stack's height shrinks as `take_from_bundle` pulls pieces off. Beams and uprights are drawn piece by
   * piece (5 beams to a layer; frames lying flat, one per layer); sheets and lumber as one block of
   * `count` layers with a line per layer at the edge.
   */
  private stack(e: Entity, sx: number, sy: number, sz: number, v: Partial<View>) {
    const g = new THREE.Group();
    for (const s of [-1, 1]) g.add(this.box('#5b4632', (s * sx) / 3, 0, 0, 0.09, DUNNAGE, sz));
    const inner = new THREE.Group();
    g.add(inner);
    v.stack = { group: inner, count: -1 };
    this.fillStack(e, v.stack, sx, sy, sz);
    return g;
  }

  private fillStack(e: Entity, st: Stack, sx: number, sy: number, sz: number) {
    const b = BUNDLES[e.def], n = Math.max(0, bundleCount(e) ?? 0);
    if (!b || n === st.count) return;
    st.count = n;
    st.group.clear();
    const piece = CATALOG[b.piece];
    const color = piece?.color ?? '#c9a36b';
    const perLayer = e.def.startsWith('stack-beam') ? 5 : e.def.startsWith('stack-upright') ? 1 : 1;
    const layers = Math.ceil(b.capacity / perLayer);
    const lh = (sy - DUNNAGE) / layers;
    let top = DUNNAGE;
    if (e.def.startsWith('stack-beam')) {
      const pw = sz / perLayer;
      for (let i = 0; i < n; i++) {
        const layer = Math.floor(i / perLayer), k = i % perLayer;
        st.group.add(this.box(color, 0, DUNNAGE + layer * lh, -sz / 2 + pw * (k + 0.5), sx, lh * 0.9, pw * 0.8, 0.25));
      }
      top = DUNNAGE + Math.ceil(n / perLayer) * lh;
    } else if (e.def.startsWith('stack-upright')) {
      // frames lying flat: two columns along the length, a few crossbars between them
      const t = lh * 0.8;
      for (let i = 0; i < n; i++) {
        const y = DUNNAGE + i * lh;
        for (const s of [-1, 1]) st.group.add(this.box(color, 0, y, (s * (sz - 0.08)) / 2, sx, t, 0.08, 0.25));
        for (let k = 0; k < 6; k++) st.group.add(this.box(color, -sx / 2 + 0.1 + ((sx - 0.2) * k) / 5, y + t * 0.25, 0, 0.04, t * 0.5, sz - 0.1, 0.25));
      }
      top = DUNNAGE + n * lh;
    } else {
      top = DUNNAGE + n * lh;
      if (n > 0) {
        st.group.add(this.box(color, 0, DUNNAGE, 0, sx, n * lh, sz));
        // a thin dark line every few layers on the long sides so the stack reads as sheets / boards
        const every = Math.max(1, Math.round(0.04 / lh));
        for (let k = every; k < n; k += every) for (const s of [-1, 1]) st.group.add(this.box('#8a6a45', 0, DUNNAGE + k * lh - 0.002, (s * sz) / 2, sx + 0.002, 0.004, 0.004));
      }
    }
    // straps round the pieces (over the top, down both sides), 3 along a long bundle, 2 along a short one
    if (n > 0) {
      const h = top - DUNNAGE, k = sx > 3 ? 3 : 2;
      for (let i = 0; i < k; i++) {
        const x = -sx / 2 + (sx * (i + 0.5)) / k;
        st.group.add(this.box(STRAP, x, top, 0, 0.035, 0.006, sz + 0.012));
        for (const s of [-1, 1]) st.group.add(this.box(STRAP, x, DUNNAGE, (s * (sz + 0.006)) / 2, 0.035, h + 0.006, 0.006));
      }
    }
  }

  /** Cutting station (catalog-stock.ts): in-feed and out-feed tables either side of a chop-saw bench. */
  private cutting(sx: number, sy: number, sz: number, color: string) {
    const g = new THREE.Group();
    const leg = '#3a3f44', top = 0.04;
    g.add(this.box('#b89a6a', 0, sy - top, 0, sx, top, sz * 0.7)); // table top (in-feed · saw · out-feed)
    for (const x of [-1, 1]) for (const z of [-1, 1]) g.add(this.box(leg, x * (sx / 2 - 0.08), 0, z * (sz * 0.35 - 0.05), 0.05, sy - top, 0.05, 0.3));
    for (const x of [-1, 0, 1]) g.add(this.box(leg, x * (sx / 2 - 0.08), 0.25, 0, 0.04, 0.04, sz * 0.7 - 0.1, 0.3)); // stretchers
    // the saw: motor block on a turntable at the back of the middle, blade over the fence
    g.add(this.box(color, 0, sy, -sz * 0.18, 0.42, 0.06, 0.34, 0.3));
    g.add(this.box('#c43d2a', 0, sy + 0.06, -sz * 0.24, 0.16, 0.26, 0.22, 0.2));
    const blade = new THREE.Mesh(this.keep(new THREE.CylinderGeometry(0.13, 0.13, 0.006, 24).rotateX(Math.PI / 2)), this.std('#cfd3d6', 0.4, 0.8));
    blade.position.set(0, sy + 0.17, -sz * 0.12);
    blade.castShadow = true;
    g.add(blade);
    g.add(this.box(leg, 0, sy, -sz * 0.05, sx * 0.9, 0.06, 0.02, 0.4)); // fence
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
    else if (e.def === 'campfire') obj = this.campfire(e.id, sx, v);
    else if (e.def === 'standing-display') obj = this.standingDisplay(sx, sy, sz, v);
    else if (e.def === 'speaker-lectern') obj = this.lectern(sx, sy, sz);
    else if (e.def === 'table-6ft') obj = tableObject(sx, sy, sz, this.std(color), this.std('#5c5f63', 0.5, 0.4));
    else if (BUNDLES[e.def]) obj = this.stack(e, sx, sy, sz, v);
    else if (e.def === 'cutting-station') obj = this.cutting(sx, sy, sz, color);
    else obj = this.box(color, 0, 0, 0, sx, sy, sz);
    obj.name = e.id;
    v.obj = obj;
    return v as View;
  }

  /** Dusk: the fire's light comes on and its flames brighten (applied on the next `render`). */
  setDusk(on: boolean) {
    this.dusk = on;
  }

  reset(world: Pick<WorldState, 'entities'>) {
    this.clear();
    this.onTick(world);
  }

  clear() {
    for (const v of this.views.values()) { v.fire?.dispose(); v.screen?.texture.dispose(); v.screen?.material.dispose(); }
    this.group.clear();
    this.views.clear();
  }

  /** Create/remove fixture meshes to match the world and copy their poses. */
  onTick(world: Pick<WorldState, 'entities'>) {
    for (const e of Object.values(world.entities)) {
      if (e.kind !== 'fixture') continue;
      let v = this.views.get(e.id);
      if (!v || v.key !== e.def) {
        if (v) {
          this.group.remove(v.obj);
          v.fire?.dispose();
          v.screen?.texture.dispose(); v.screen?.material.dispose();
        }
        v = this.build(e);
        this.views.set(e.id, v);
        this.group.add(v.obj);
      }
      v.obj.position.set(e.pose.p[0], e.pose.p[1], e.pose.p[2]);
      v.obj.rotation.set(0, -e.pose.yaw, 0);
      if (v.stack) {
        const [sx, sy, sz] = CATALOG[e.def].size;
        this.fillStack(e, v.stack, sx, sy, sz);
      }
      if (v.screen) this.drawScreen(e, v.screen);
    }
    for (const [id, v] of this.views)
      if (!world.entities[id]) {
        this.group.remove(v.obj);
        v.fire?.dispose();
        v.screen?.texture.dispose(); v.screen?.material.dispose();
        this.views.delete(id);
      }
  }

  /** Pieces drawn per bundle / stack (tests: the stack shrinks with contents.count). */
  stacks() {
    return [...this.views].filter(([, v]) => v.stack).map(([id, v]) => {
      const b = new THREE.Box3().setFromObject(v.stack!.group);
      return { id, def: v.key, count: v.stack!.count, top: b.isEmpty() ? null : +b.max.y.toFixed(3) };
    });
  }

  /** Animate the fires: a pure function of (entity id, `t` = seconds of sim time). */
  render(t: number) {
    for (const v of this.views.values()) v.fire?.update(t, this.dusk ? 1 : 0.6, this.dusk ? 1 : 0);
  }

  dispose() {
    this.clear();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats.values()) m.dispose();
    this.mats.clear();
  }
}
