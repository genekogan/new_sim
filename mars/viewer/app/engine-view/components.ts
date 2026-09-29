// World components → meshes. One persistent mesh per entity; poses are
// snapshotted after every fixed tick and interpolated between the last two
// ticks (like humans.ts), so a carried beam moves with its carriers instead of
// snapping at tick rate. Orientation matches engine entityCorners(): roll about
// Z, then pitch about X, then yaw about Y = three Euler(pitch, -yaw, roll, 'YXZ'),
// local box origin at the base centre.
import * as THREE from 'three';
import type { Entity, WorldState } from '../../engine/world/types.ts';
import { def } from '../../engine/world/catalog.ts';
import { isPanel, isRail } from '../../engine/world/catalog-solar.ts';
import { itemObject, setFill, type ItemObject } from './items.ts';
import { PaintOverlay } from './paint.ts';
import { rendererColor } from './palette.ts';
import { solarPanelMesh, solarRailMesh, solarTiltLegs } from './solar-mesh.ts';
import { equipmentMesh } from './equipment-mesh.ts';

type Pose = { p: [number, number, number]; yaw: number; pitch: number; roll: number };
type View = { obj: THREE.Object3D; prev: Pose; cur: Pose; key: string; item?: ItemObject; inHand?: { by: string; hand: 'left' | 'right' }; paint?: PaintOverlay; label?: string; mount?: string };
/** What a renderer of people offers held items: the rendered palm of a hand, and the head (mouth point, yaw). */
export type Holders = { palmOf(id: string, hand: 'left' | 'right', out: THREE.Vector3): boolean; headOf(id: string, out: THREE.Vector3): number | null };

const FALLBACK = '#d8b98a';
/** Catalog colours drawn slightly metallic: rack steel, stringers, aluminium (rails, panel frames). */
const METAL = new Set(['#1f5fbf', '#e86a1a', '#b8b8b8', '#b8bcc2']);
const GLASS = '#10182c';
const _palm = new THREE.Vector3(), _mouth = new THREE.Vector3(), _bowl = new THREE.Vector3(), _aim = new THREE.Vector3(), _dir = new THREE.Vector3(), _grip = new THREE.Vector3(), _x = new THREE.Vector3(1, 0, 0);
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

  private mat(color: string, side: THREE.Side = THREE.FrontSide) {
    const key = side === THREE.FrontSide ? color : `${color}:${side}`;
    let m = this.mats.get(key);
    if (!m) this.mats.set(key, (m = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: METAL.has(color) ? 0.25 : 0, side })));
    return m;
  }
  private kit = { mat: (c: string, side?: THREE.Side) => this.mat(c, side), geo: (k: string, make: () => THREE.BufferGeometry) => this.geo(k, make) };

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
  private build(e: Entity, v?: Partial<View>): THREE.Object3D {
    const d = def(e.def);
    const [sx, sy, sz] = d.size;
    const color = rendererColor(d, FALLBACK);
    if (d.category === 'item') {
      const it = itemObject(e.def, [sx, sy, sz], color, this.kit);
      if (it && v) v.item = it;
      if (it) return it.obj;
    }
    if (d.category === 'stair' && d.stair) return this.flight(e.def, sx, sy, sz, d.stair.treads, color);
    if (d.category === 'rack-upright') return this.upright(e.def, sx, sy, sz, color);
    if (isRail(e.def)) return solarRailMesh(sx, this.kit);
    if (isPanel(e.def)) {
      if (v) v.mount = mountKey(e);
      return this.panel(e, sx, sy, sz);
    }
    if (d.category === 'equipment') {
      if (v) v.label = labelKey(e);
      return this.equipment(e, sx, sy, sz, color);
    }
    return this.mesh(this.geo(`box:${e.def}`, () => new THREE.BoxGeometry(sx, sy, sz).translate(0, sy / 2, 0)), color);
  }

  /**
   * Upright = two columns (local x = ±depth/2) joined by diagonal bracing, the
   * whole thing inside the catalog box. Reads as the braced frame (drawn in the photo green,
   * palette.ts RACK_FRAME_GREEN) rather than a solid slab, and makes pitch/lying orientation obvious.
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
    const rung = this.geo(`rung:${id}`, () => new THREE.BoxGeometry(inner, 0.035, t * 0.6));
    if (id.endsWith('-kit')) {
      // reconstruction frames (catalog-stock.ts): the Kit's bracing (app/history/kit.ts Kit.frame) — one rod per
      // 0.7 m, from column −x at 0.25 + 0.7k to column +x 0.66 m higher, all the same way. Its ends are the
      // bracing nodes people stand on (engine/construction/stance.ts rungs: 0.25 + 0.7k, 0.91 + 0.7k).
      const rise = 0.66, len = Math.hypot(inner, rise);
      const rod = this.geo(`kit-brace:${id}`, () => new THREE.BoxGeometry(len, 0.028, t * 0.5));
      for (let y = 0.25; y < h - 0.6; y += 0.7) {
        const b = this.mesh(rod, color);
        b.position.set(0, y + rise / 2, 0);
        b.rotation.z = Math.atan2(rise, inner);
        g.add(b);
      }
    } else {
      const n = Math.max(1, Math.round((h - 0.2) / bay));
      const step = (h - 0.2) / n;
      const len = Math.hypot(inner, step);
      const brace = this.geo(`brace:${id}:${n}`, () => new THREE.BoxGeometry(len, 0.03, t * 0.6));
      for (let i = 0; i < n; i++) {
        const b = this.mesh(brace, color);
        b.position.set(0, 0.1 + step * (i + 0.5), 0);
        b.rotation.z = (i % 2 ? 1 : -1) * Math.atan2(step, inner);
        g.add(b);
      }
    }
    for (const y of [0.1, h - 0.1]) {
      const r = this.mesh(rung, color);
      r.position.y = y;
      g.add(r);
    }
    return g;
  }

  /**
   * Solar panel (catalog-solar.ts: local x = length, y = frame depth, z = width): dark glass laminate
   * inside an aluminium frame, faint cell rows. Tilt is the engine pose (pitch / roll), like any part.
   * An installed tilted module also gets two plumb rear risers under its high edge, down to the level of
   * its low edge (the rails' top; SOLAR_PAINT.md install_panel); a carried or flat one gets none.
   */
  private panel(e: Entity, l: number, t: number, w: number) {
    const g = solarPanelMesh(e.def, l, t, w, this.kit);
    if (!mountKey(e)) return g;
    const pitch = e.pose.pitch ?? 0, roll = e.pose.roll ?? 0;
    // engine/construction/solar.ts tiltedPose: roll lifts local +x (tilt axis ∥ z), pitch lifts local −z (axis ∥ x)
    const byRoll = Math.abs(roll) >= Math.abs(pitch);
    const tilt = byRoll ? roll : pitch, span = byRoll ? l : w, edge = byRoll ? w : l;
    const legs = solarTiltLegs(edge, span * Math.abs(Math.sin(tilt)), this.kit);
    if (byRoll) legs.position.x = (Math.sign(tilt) * l) / 2;
    else legs.position.z = (-Math.sign(tilt) * w) / 2;
    // undo the panel's tilt so the risers hang plumb; along the high edge (the legs' local x)
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, 0, roll, 'YXZ')).invert();
    legs.quaternion.copy(byRoll ? q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)) : q);
    g.add(legs);
    return g;
  }

  private glassMat?: THREE.MeshStandardMaterial;
  private glass() {
    return (this.glassMat ??= new THREE.MeshStandardMaterial({ color: GLASS, roughness: 0.18, metalness: 0.55 }));
  }

  /** Battery / charge controller / inverter: its box plus a label plate on the top and the front (local +z). */
  private equipment(e: Entity, sx: number, sy: number, sz: number, color: string) {
    return equipmentMesh(e, sx, sy, sz, color, this.kit, labelTexture(labelText(e)));
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
    for (const v of this.views.values()) disposeOwned(v);
    this.group.clear();
    this.views.clear();
  }

  /** Call after every engine tick (or with a sampled take frame, then `render(1)`). */
  onTick(world: Pick<WorldState, 'entities'>) {
    for (const e of Object.values(world.entities)) {
      if (e.kind !== 'component') continue;
      let v = this.views.get(e.id);
      if (!v || v.key !== e.def || (v.label !== undefined && v.label !== labelKey(e)) || (v.mount !== undefined && v.mount !== mountKey(e))) {
        if (v) {
          this.group.remove(v.obj);
          disposeOwned(v);
        }
        const nv: Partial<View> = {};
        const obj = this.build(e, nv);
        obj.name = e.id;
        this.group.add(obj);
        const p = poseOf(e);
        v = { obj, prev: p, cur: p, key: e.def, item: nv.item, label: nv.label, mount: nv.mount };
      } else {
        v.prev = v.cur;
        v.cur = poseOf(e);
      }
      this.views.set(e.id, v);
      if (v.item) setFill(v.item, e.contents?.fraction);
      if (e.paint || v.paint) (v.paint ??= new PaintOverlay(v.obj)).update(e);
      v.inHand = e.support?.kind === 'in-hand' ? { by: e.support.by, hand: e.support.hand } : undefined;
    }
    for (const [id, v] of this.views)
      if (!world.entities[id]) {
        this.group.remove(v.obj);
        disposeOwned(v);
        this.views.delete(id);
      }
  }

  /** Paint overlays drawn (tests: bands and their drawn coverage). */
  paints() {
    return [...this.views].filter(([, v]) => v.paint?.state).map(([id, v]) => ({ id, ...v.paint!.state! }));
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
   * Items held in a hand (support `in-hand`) ride on the holder's rendered palm with the catalog grip
   * offset (item pose = palm − rot(grip, yaw), upright, yaw = the holder's), instead of the engine's
   * tick pose: when an arm honestly cannot reach its engine hand point, the item stays in the hand.
   * A spoon points from the hand toward the bowl in the other hand when low and toward the mouth
   * when raised, sliding back in the grip so its tip stops at the lips. Call after the people render.
   */
  attachHeld(holders: Holders) {
    for (const v of this.views.values()) {
      if (!v.inHand || !holders.palmOf(v.inHand.by, v.inHand.hand, _palm)) continue;
      const yaw = holders.headOf(v.inHand.by, _mouth) ?? -v.obj.rotation.y;
      const g = def(v.key).handling?.grips?.[1]?.[0]?.local ?? [0, 0, 0];
      _grip.set(g[0], g[1], g[2]);
      if (v.key === 'spoon') {
        const other = v.inHand.hand === 'left' ? 'right' : 'left';
        const hasBowl = holders.palmOf(v.inHand.by, other, _bowl);
        if (!hasBowl) _bowl.copy(_palm).add(_dir.set(Math.cos(yaw) * 0.2, -0.1, Math.sin(yaw) * 0.2));
        else _bowl.y += 0.03;
        const span = Math.max(0.05, _mouth.y - _bowl.y);
        const k = Math.max(0, Math.min(1, (_palm.y - _bowl.y) / span));
        _aim.copy(_bowl).lerp(_mouth, k * k);
        _dir.subVectors(_aim, _palm);
        if (_dir.lengthSq() < 1e-6) _dir.set(Math.cos(yaw), 0, Math.sin(yaw));
        const reach = _dir.length();
        _dir.normalize();
        v.obj.quaternion.setFromUnitVectors(_x, _dir);
        _grip.applyQuaternion(v.obj.quaternion);
        v.obj.position.copy(_palm).sub(_grip);
        // tip (local +x end) no further than the aim point: slide the spoon back in the hand
        const tip = def('spoon').size[0] / 2 - g[0];
        if (tip > reach) v.obj.position.addScaledVector(_dir, reach - tip);
      } else {
        v.obj.rotation.set(0, -yaw, 0);
        _grip.applyEuler(v.obj.rotation);
        v.obj.position.copy(_palm).sub(_grip);
      }
    }
  }

  /** Rendered world position of an entity's origin (tests: held items vs hands). */
  positionOf(id: string) {
    const v = this.views.get(id);
    if (!v) return null;
    v.obj.updateMatrixWorld(true);
    return v.obj.getWorldPosition(new THREE.Vector3()).toArray();
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
    this.glassMat?.dispose();
    for (const g of this.geos.values()) g.dispose();
    for (const m of this.mats.values()) m.dispose();
    this.geos.clear();
    this.mats.clear();
  }
}

/** Label plate text: equipment kind and its configuration (entity `equipment`, else the catalog defaults). */
function labelText(e: Entity): string[] {
  const d = def(e.def);
  const kind = e.equipment?.kind ?? d.equipment?.kind ?? e.def;
  const c: Record<string, unknown> = { ...d.equipment?.defaults, ...e.equipment?.config };
  const unit: Record<string, string> = { voltage: 'V', capacityAh: 'Ah', maxPvVoltage: 'V PV', maxCurrentA: 'A', powerW: 'W', dcVoltage: 'V DC', acVoltage: 'V AC' };
  const parts = Object.keys(c).sort().map((k) => (unit[k] ? `${String(c[k])} ${unit[k]}` : String(c[k])));
  return [kind.toUpperCase().replace('-', ' '), parts.join(' · ')];
}
/** Installed tilted solar module: its tilt (so the view rebuilds with risers once fastened); '' otherwise. */
const mountKey = (e: Entity) => (e.phase === 'installed' && (e.pose.pitch || e.pose.roll) ? `${e.pose.pitch ?? 0}:${e.pose.roll ?? 0}` : '');
const labelKey = (e: Entity) => (def(e.def).category === 'equipment' ? labelText(e).join('|') : '');

/** A small white-on-dark label texture (two lines). */
function labelTexture(lines: string[]) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 108;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f2f2ee';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#1b1b1b';
  g.lineWidth = 6;
  g.strokeRect(3, 3, c.width - 6, c.height - 6);
  g.fillStyle = '#111';
  g.textAlign = 'center';
  g.font = 'bold 34px sans-serif';
  g.fillText(lines[0], c.width / 2, 44, c.width - 16);
  g.font = '22px sans-serif';
  g.fillText(lines[1] ?? '', c.width / 2, 84, c.width - 16);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Free what a view built for itself (label textures / materials, paint overlays); shared geometry stays. */
function disposeOwned(v: View) {
  v.paint?.dispose();
  v.obj.traverse((o) => {
    if (o.name !== 'label' || !(o instanceof THREE.Mesh)) return;
    o.geometry.dispose();
    const m = o.material as THREE.MeshBasicMaterial;
    m.map?.dispose();
    m.dispose();
  });
}
