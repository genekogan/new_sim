// Question captures (docs/engineering/questions/): outline + label entities by id, drawn on top of
// everything (depthTest off) so objects under a roof still show. Renderer-only; reads world / scene data.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { obbCorners, type Vec2 } from '../../engine/core/math.ts';
import { entityCorners } from '../../engine/spatial/service.ts';
import type { Obstacle } from '../../engine/spatial/types.ts';
import type { LabSim } from './sim.ts';

export type HighlightOpts = {
  /** Outline colour (CSS). Default red. */
  color?: string;
  /** Tube radius of the outline (m). Default 0.07. */
  width?: number;
  /** Prism height for region footprints (m). Default 3. */
  height?: number;
  /** One label over the union of all ids instead of one per id. */
  single?: boolean;
  /** Extra height of the label anchor above the object's top (m). Default 0.4. */
  lift?: number;
};
type Prism = { ring: Vec2[]; y0: number; y1: number };

/** Convex hull (monotone chain), counter-clockwise. */
function hull(pts: Vec2[]): Vec2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Vec2[] = [], up: Vec2[] = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  for (const q of p.reverse()) {
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/** Prisms for one id: `x` exact, `x*` prefix. World entities, then scene obstacles, then region footprints. */
function resolve(rt: LabSim['rt'], id: string, height: number): Prism[] {
  const prefix = id.endsWith('*') ? id.slice(0, -1) : null;
  const hit = (x: string) => (prefix === null ? x === id : x.startsWith(prefix));
  const ents = Object.values(rt.world.entities).filter((e) => hit(e.id) && e.kind !== 'human');
  if (ents.length) {
    return ents.map((e) => {
      const c = entityCorners(e);
      return { ring: hull(c.map((q) => [q[0], q[2]] as Vec2)), y0: Math.min(...c.map((q) => q[1])), y1: Math.max(...c.map((q) => q[1])) };
    });
  }
  const obs = (rt.services.spatial.base.obstacles as Obstacle[]).filter((o) => hit(o.id));
  if (obs.length) return obs.map((o) => ({ ring: obbCorners(o.obb), y0: o.y0, y1: o.y1 }));
  const regs = Object.values(rt.world.regions).filter((r) => hit(r.id));
  return regs.map((r) => ({ ring: hull(r.polygon as Vec2[]), y0: 0, y1: height }));
}

export class Highlights {
  readonly group = new THREE.Group();

  constructor() {
    this.group.name = 'question-highlights';
  }

  clear() {
    for (const o of Array.from(this.group.children)) {
      this.group.remove(o);
      o.traverse((m) => {
        const mesh = m as THREE.Mesh;
        mesh.geometry?.dispose();
        (mesh.material as THREE.Material | undefined)?.dispose?.();
      });
    }
  }

  /** Outline `ids` (exact or `prefix*`) and label them with an arrow. Throws when no id resolves. */
  add(rt: LabSim['rt'], ids: string[], label?: string, opts: HighlightOpts = {}) {
    const color = new THREE.Color(opts.color ?? '#ff2a2a');
    const r = opts.width ?? 0.07;
    const found: string[] = [], missing: string[] = [];
    const all: Prism[] = [];
    const tops: { at: THREE.Vector3 }[] = [];
    for (const id of ids) {
      const ps = resolve(rt, id, opts.height ?? 3);
      if (!ps.length) {
        missing.push(id);
        continue;
      }
      found.push(id);
      all.push(...ps);
      if (!opts.single) tops.push({ at: anchor(ps, opts.lift ?? 0.4) });
    }
    if (!found.length) throw Error(`highlight: no entity, obstacle or region matches ${ids.join(', ')}`);
    if (opts.single) tops.push({ at: anchor(all, opts.lift ?? 0.4) });
    const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95 });
    const fill = new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.22, side: THREE.DoubleSide });
    for (const p of all) {
      const n = p.ring.length;
      for (let i = 0; i < n; i++) {
        const a = p.ring[i], b = p.ring[(i + 1) % n];
        this.tube(new THREE.Vector3(a[0], p.y0, a[1]), new THREE.Vector3(b[0], p.y0, b[1]), r, mat);
        this.tube(new THREE.Vector3(a[0], p.y1, a[1]), new THREE.Vector3(b[0], p.y1, b[1]), r, mat);
        this.tube(new THREE.Vector3(a[0], p.y0, a[1]), new THREE.Vector3(a[0], p.y1, a[1]), r, mat);
      }
      const shape = new THREE.Shape(p.ring.map(([x, z]) => new THREE.Vector2(x, -z)));
      const f = new THREE.Mesh(new THREE.ShapeGeometry(shape), fill);
      f.rotation.x = -Math.PI / 2;
      f.position.y = p.y1;
      f.renderOrder = 999;
      this.group.add(f);
    }
    if (label) for (const t of tops) this.group.add(tag(label, t.at, `#${color.getHexString()}`));
    const box = new THREE.Box3();
    for (const p of all) for (const [x, z] of p.ring) box.expandByPoint(new THREE.Vector3(x, p.y0, z)).expandByPoint(new THREE.Vector3(x, p.y1, z));
    return { found, missing, box: { min: box.min.toArray(), max: box.max.toArray() } };
  }

  private tube(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material) {
    const len = a.distanceTo(b);
    if (len < 1e-4) return;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6, 1), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    m.renderOrder = 1000;
    this.group.add(m);
  }
}

function anchor(ps: Prism[], lift: number) {
  let x = 0, z = 0, n = 0, top = -Infinity;
  for (const p of ps) {
    for (const [px, pz] of p.ring) { x += px; z += pz; n++; }
    top = Math.max(top, p.y1);
  }
  return new THREE.Vector3(x / n, top + lift, z / n);
}

/** Label pill + arrow; the arrow tip sits on `at`. */
function tag(text: string, at: THREE.Vector3, color: string) {
  const el = document.createElement('div');
  el.style.cssText = 'display:flex;flex-direction:column;align-items:center;pointer-events:none;font:600 15px/1.2 system-ui,sans-serif';
  const pill = document.createElement('div');
  pill.textContent = text;
  pill.style.cssText = `background:#fff;color:#111;border:3px solid ${color};border-radius:6px;padding:3px 8px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.35)`;
  const stem = document.createElement('div');
  stem.style.cssText = `width:4px;height:34px;background:${color}`;
  const head = document.createElement('div');
  head.style.cssText = `width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;border-top:14px solid ${color}`;
  for (const c of [pill, stem, head]) el.appendChild(c);
  const o = new CSS2DObject(el);
  o.center.set(0.5, 1);
  o.position.copy(at);
  return o;
}
