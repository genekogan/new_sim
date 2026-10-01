// Small hand-held items and the folding table (owner feedback §12, engine/world/catalog-items.ts,
// ITEMS.md) as simple meshes inside their catalog boxes, local origin at the base centre (as every
// component). Containers get a food disc whose height follows `contents.fraction` (0 = hidden).
// Placement is components.ts's job: resting items at their engine pose; items `in-hand` on the
// holder's rendered palm with the catalog grip offset (attachHeld).
import * as THREE from 'three';
import { chessTokenObject } from './chess.ts';

export const FOOD_COLOR: Record<string, string> = { stew: '#7b4a22' };

export type ItemObject = { obj: THREE.Object3D; fill?: THREE.Mesh; fillSpan?: [number, number, number, number]; leaf?: THREE.Group; bookmark?: THREE.Object3D };

export type Kit = { mat: (color: string, side?: THREE.Side) => THREE.Material; geo: (key: string, make: () => THREE.BufferGeometry) => THREE.BufferGeometry };

const mesh = (g: THREE.BufferGeometry, m: THREE.Material) => {
  const o = new THREE.Mesh(g, m);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
};

/** A lathe-turned open vessel: radius r0 at the base, r1 at the rim, height h, wall t. */
function vessel(r0: number, r1: number, h: number, t: number, seg = 20) {
  const pts = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(r0, 0),
    new THREE.Vector2(r0 + (r1 - r0) * 0.55, h * 0.45),
    new THREE.Vector2(r1, h),
    new THREE.Vector2(r1 - t, h),
    new THREE.Vector2(r0 + (r1 - r0) * 0.55 - t, h * 0.45),
    new THREE.Vector2(r0 - t, t),
    new THREE.Vector2(0, t),
  ];
  return new THREE.LatheGeometry(pts, seg);
}

/**
 * Item mesh for a catalog item def (size x·y·z), or null for an unknown def (the caller draws a box).
 * `fillSpan` = [y at empty, y at full, radius at empty, radius at full] of the food disc.
 */
export function itemObject(def: string, size: [number, number, number], color: string, kit: Kit): ItemObject | null {
  const chess = chessTokenObject(def, size, color, kit);
  if (chess) return chess;
  const [sx, sy] = size;
  const g = new THREE.Group();
  const add = (o: THREE.Object3D) => (g.add(o), o);
  const food = () => {
    const m = mesh(kit.geo('food-disc', () => new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2)), kit.mat(FOOD_COLOR.stew));
    m.castShadow = false;
    m.visible = false;
    g.add(m);
    return m;
  };
  if (def === 'reading-book') {
    const [, , depth] = size;
    const cover = add(mesh(kit.geo('reading-cover', () => new THREE.BoxGeometry(sx, .004, depth)), kit.mat(color)));
    cover.position.y = .002;
    const pages = add(mesh(kit.geo('reading-pages', () => new THREE.BoxGeometry(sx-.008, sy-.008, depth-.008)), kit.mat('#ece6d7')));
    pages.position.y = sy / 2;
    for (const side of [-1,1]) for (let line = 0; line < 6; line++) {
      const ink = add(mesh(kit.geo('reading-line', () => new THREE.BoxGeometry(sx*.34, .0005, .0015)), kit.mat('#787365')));
      ink.position.set(side*sx*.25,sy+.0005,(line-2.5)*depth*.11);
    }
    const leaf = new THREE.Group(); leaf.position.y = sy+.001; g.add(leaf);
    const sheet=mesh(kit.geo('reading-leaf', () => new THREE.BoxGeometry(sx/2-.004,.001,depth-.008)),kit.mat('#f5efdf'));
    sheet.position.x = sx/4; leaf.add(sheet);
    const bookmark = add(mesh(kit.geo('reading-bookmark', () => new THREE.BoxGeometry(.012,.001,depth*.55)),kit.mat('#b83535')));
    bookmark.position.set(-sx*.4,sy+.003,depth*.3);
    return {obj:g,leaf,bookmark};
  }
  if (def === 'bowl') {
    add(mesh(kit.geo('bowl', () => vessel(sx * 0.3, sx / 2, sy, 0.006)), kit.mat(color, THREE.DoubleSide)));
    return { obj: g, fill: food(), fillSpan: [0.008, sy * 0.85, sx * 0.3, sx * 0.47] };
  }
  if (def === 'cup') {
    add(mesh(kit.geo('cup', () => vessel(sx * 0.42, sx / 2, sy, 0.005)), kit.mat(color, THREE.DoubleSide)));
    return { obj: g, fill: food(), fillSpan: [0.008, sy * 0.85, sx * 0.4, sx * 0.47] };
  }
  if (def === 'plate') {
    add(mesh(kit.geo('plate', () => vessel(sx * 0.36, sx / 2, sy, 0.005)), kit.mat(color, THREE.DoubleSide)));
    return { obj: g, fill: food(), fillSpan: [0.006, sy * 0.7, sx * 0.3, sx * 0.4] };
  }
  if (def === 'pot') {
    add(mesh(kit.geo('pot', () => vessel(sx * 0.46, sx * 0.48, sy, 0.008)), kit.mat(color, THREE.DoubleSide)));
    for (const s of [-1, 1]) {
      const hdl = add(mesh(kit.geo('pot-handle', () => new THREE.TorusGeometry(0.03, 0.007, 6, 12, Math.PI)), kit.mat('#3a3a3a')));
      hdl.position.set(s * sx * 0.49, sy * 0.86, 0);
      hdl.rotation.set(Math.PI / 2, 0, s > 0 ? -Math.PI / 2 : Math.PI / 2);
    }
    return { obj: g, fill: food(), fillSpan: [0.01, sy * 0.85, sx * 0.44, sx * 0.46] };
  }
  if (def === 'spoon') {
    // handle from the grip end (−x) to the neck, bowl of the spoon at +x
    const handle = add(mesh(kit.geo('spoon-handle', () => new THREE.BoxGeometry(sx * 0.68, 0.005, 0.012)), kit.mat(color)));
    handle.position.set(-sx / 2 + sx * 0.34, sy * 0.5, 0);
    const head = add(mesh(kit.geo('spoon-head', () => new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(0.03, 0.012, 0.02).rotateX(Math.PI)), kit.mat(color, THREE.DoubleSide)));
    head.position.set(sx / 2 - 0.03, sy * 0.95, 0);
    return { obj: g };
  }
  return null;
}

/** Secondary page expression reads the authoritative bookmark; it never moves the book. */
export function setReading(it: ItemObject, state: Record<string, string | number | boolean> | undefined, pages: number) {
  if (!it.leaf || !it.bookmark) return;
  const seconds=typeof state?.readSeconds === 'number' ? state.readSeconds : 0;
  const duration=typeof state?.durationSeconds === 'number' ? state.durationSeconds : 0;
  const progress=duration > 0 ? Math.max(0,Math.min(1,seconds/duration)) : 0;
  const section=progress*pages, local=section-Math.floor(section);
  const turn=state?.phase === 'reading' && progress < 1 && local>.93 ? (local-.93)/.07 : 0;
  it.leaf.rotation.z=turn*Math.PI;
  it.bookmark.position.x=-.096+.192*progress;
}

/** Food disc height / radius for a fill fraction (hidden when empty). */
export function setFill(it: ItemObject, fraction: number | undefined) {
  if (!it.fill || !it.fillSpan) return;
  const f = Math.max(0, Math.min(1, fraction ?? 0));
  it.fill.visible = f > 0.001;
  const [y0, y1, r0, r1] = it.fillSpan;
  const r = r0 + (r1 - r0) * f;
  it.fill.position.y = y0 + (y1 - y0) * f;
  it.fill.scale.set(r, 1, r);
}

/** 6 ft folding table: top slab + folding legs, inside its catalog box (w × h × d). */
export function tableObject(w: number, h: number, d: number, top: THREE.Material, legs: THREE.Material) {
  const g = new THREE.Group();
  const box = (sx: number, sy: number, sz: number, m: THREE.Material) => mesh(new THREE.BoxGeometry(sx, sy, sz), m);
  const slab = box(w, 0.035, d, top);
  slab.position.y = h - 0.0175;
  g.add(slab);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = box(0.03, h - 0.035, 0.03, legs);
      leg.position.set(sx * (w / 2 - 0.12), (h - 0.035) / 2, sz * (d / 2 - 0.06));
      g.add(leg);
    }
    const bar = box(0.025, 0.025, d - 0.12, legs);
    bar.position.set(sx * (w / 2 - 0.12), 0.12, 0);
    g.add(bar);
  }
  return g;
}
