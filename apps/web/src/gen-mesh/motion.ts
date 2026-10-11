// Client-side decorative motion: spin, sway, hover, route, creature gaits and behaviours, night
// glow — all pure functions of world time and the entity's seed, so every viewer sees the same
// thing with no sync. Owner: L4. Spec <eden4>/33 §3.2, 29 WP4b.
//
// The entity layer calls `animate` every frame for entities whose def `hasMotion`, after it has
// set the resting pose (position, uniform scale, yaw). Creatures carry a `rig` in userData (set by
// creatures/creature.mesh.ts or the animals/1 herd builder): role pivots plus the world model for
// terrain, water and solids. Gaits: quadruped-walk, biped-waddle, bird-fly, fish-swim, hover.
import type * as THREE from 'three';
import type { Entity, StoredDef, WorldModel } from '@sim/world-compiler';
import { pose, RouteCache, rand, seedOf, type BehaviorKind, type Plan, type Pose, type Surroundings, type V2 } from './creatures/behavior.ts';

/** True if this entity needs per-frame motion (the layer only calls `animate` for these). */
export function hasMotion(def: StoredDef): boolean {
  const c = def.components;
  if (c.spin || c.sway || c.hover || c.route || c.behavior || c.light) return true;
  if (def.tags.includes('creature') || def.tags.includes('moving')) return true;
  if (def.make.kind === 'gen' && def.make.gen === 'animals/1') return true;
  const gait = def.make.kind === 'gen' && def.make.gen === 'kit/2' ? (def.make.args as { gait?: string } | undefined)?.gait : undefined;
  return !!gait && gait !== 'none';
}

let boundModel: WorldModel | null = null;
/** World time in seconds shared by every viewer: the layer passes page time (performance.now) —
 *  convert to wall-clock epoch seconds so two browsers agree; epoch values pass through. */
export function worldSeconds(t: number): number { return t > 1e8 ? t : (typeof performance !== 'undefined' ? performance.timeOrigin / 1000 : 0) + t; }
/** The layer (or any of our builders) binds the world model so motion can read terrain and water. */
export function bindMotionModel(m: WorldModel | null) { boundModel = m; }

/** Apply motion at world time `t` (seconds). `base` is the resting local transform the layer computed. */
export function animate(obj: THREE.Object3D, entity: Entity, def: StoredDef, tIn: number, base: { y: number; yaw: number }) {
  const t = worldSeconds(tIn);
  const ud = obj.userData as { tick?: (t: number) => void; rig?: Rig; model?: WorldModel };
  if (ud.tick) { ud.tick(t); return; }
  const c = def.components, phase = ((entity.seed ?? hash(entity.id)) % 1000) / 1000 * Math.PI * 2;
  const model = ud.rig?.model ?? ud.model ?? boundModel;
  if (c.route && model) routeStep(obj, entity, def, model, t, base);
  if (ud.rig) creatureStep(obj, ud.rig, entity, t, base);
  if (c.spin) {
    const ang = (t * (c.spin.rpm / 60)) * Math.PI * 2;
    const target = c.spin.role ? obj.getObjectByName(`role:${c.spin.role}`) : obj;
    if (target) { if (c.spin.axis === 'x') target.rotation.x = ang; else if (c.spin.axis === 'z') target.rotation.z = ang; else target.rotation.y = (target === obj ? base.yaw : 0) + ang; }
  }
  if (c.sway) { obj.rotation.z = Math.sin(t * (Math.PI * 2) / c.sway.period + phase) * c.sway.amount * 0.3; obj.rotation.x = Math.cos(t * (Math.PI * 2) / (c.sway.period * 1.3) + phase) * c.sway.amount * 0.2; }
  if (c.hover) obj.position.y = (c.route ? obj.position.y : base.y + c.hover.height) + Math.sin(t * (Math.PI * 2) / c.hover.period + phase) * c.hover.bob;
  if (c.light) glowStep(obj, entity, model, t);
}

// ---------------------------------------------------------------- world reading

export function waterAt(model: WorldModel, x: number, z: number): number | null {
  const g = model.ground(); let level: number | null = null;
  for (const w of g.waters) {
    if (w.area && pointInPoly(x, z, w.area)) level = w.level;
    else if (w.path && w.w && distToPath(x, z, w.path) < w.w / 2) level = w.level;
  }
  return level ?? (g.seaLevel !== undefined ? g.seaLevel : null);
}
function distToPath(x: number, z: number, path: [number, number][]) {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) { const [ax, az] = path[i - 1], [bx, bz] = path[i]; const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)); best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t)); }
  return best;
}
/** R4-LIVE: how dark the viewer's world clock makes it (0 day … 1 night), set every frame by the live view; null before
 *  any clock. Lamps then light at dusk and go out at dawn on their own, whatever the sky palette says. */
let clockNight: number | null = null;
export function setClockNight(n: number | null) { clockNight = n === null || !Number.isFinite(n) ? null : Math.max(0, Math.min(1, n)); }
export function nightOf(model: WorldModel | null): number {
  if (!model) return 0;
  if (clockNight !== null) return Math.max(clockNight, paletteNight(model));
  return paletteNight(model);
}
function paletteNight(model: WorldModel): number {
  const sky = model.state.sky as { palette?: string; sun?: number };
  if (/night|midnight/.test(sky.palette ?? '')) return 1;
  if (/dusk|dawn|twilight|sunset/.test(sky.palette ?? '')) return 0.6;
  return Math.min(1, Math.max(0, (0.3 - (sky.sun ?? 0.6)) / 0.2));
}

type Box = { c: [number, number]; half: [number, number]; yaw: number; y0: number; y1: number };
/** Solid footprints near a point, cached per model change (entity count) and refreshed every 8 s. */
class Obstacles {
  private boxes: Box[] = []; private key = ''; private at = -1e9;
  private model: WorldModel; private cx: number; private cz: number; private reach: number; private skip: Set<string>;
  constructor(model: WorldModel, cx: number, cz: number, reach: number, skip: Set<string>) { this.model = model; this.cx = cx; this.cz = cz; this.reach = reach; this.skip = skip; }
  list(t: number): Box[] {
    const k = `${this.model.entities.size}`;
    if (k === this.key && t - this.at < 8) return this.boxes;
    this.key = k; this.at = t; this.boxes = [];
    for (const e of this.model.entities.values()) {
      if (this.skip.has(e.id)) continue;
      const d = this.model.resolvedDef(e.def); if (!d || d.layer !== 'solid' || d.make.kind === 'none') continue;
      let fp: Box[]; try { fp = this.model.footprint(e, d); } catch { continue; }
      for (const b of fp) if (Math.hypot(b.c[0] - this.cx, b.c[1] - this.cz) < this.reach + Math.hypot(b.half[0], b.half[1]) && b.y1 - b.y0 > 0.12) this.boxes.push(b);
    }
    return this.boxes;
  }
}
export function surroundings(model: WorldModel, home: V2, reach: number, medium: 'land' | 'water', skip: Set<string>, area?: V2[]): Surroundings & { obstacles: Obstacles; t: number } {
  const obstacles = new Obstacles(model, home[0], home[1], reach + 4, skip);
  const half = model.constants.extent / 2 - 1;
  const s = {
    obstacles, t: 0, area,
    free(x: number, z: number, r: number) {
      if (Math.abs(x) > half || Math.abs(z) > half) return false;
      const g = model.terrain.sample(x, z), wl = waterAt(model, x, z), depth = wl === null ? -1 : wl - g;
      if (medium === 'water' ? depth < 0.25 : depth > 0.05) return false;
      if (medium === 'land' && model.terrain.slope(x, z) > 0.85) return false;
      for (const b of obstacles.list(s.t)) {
        if (b.y0 > g + 1.2 || b.y1 < g + 0.08) continue;   // overhead (table tops are fine to walk under) or flat
        const dx = x - b.c[0], dz = z - b.c[1], c = Math.cos(b.yaw), sn = Math.sin(b.yaw);
        const lu = dx * c - dz * sn, lw = dx * sn + dz * c;
        if (Math.abs(lu) < b.half[0] + r && Math.abs(lw) < b.half[1] + r) return false;
      }
      return true;
    },
  };
  return s;
}

// ---------------------------------------------------------------- creatures

export type Gait = 'quadruped-walk' | 'biped-waddle' | 'bird-fly' | 'fish-swim' | 'hover' | 'none';
export type Rig = {
  gait: Gait; kind: BehaviorKind; speed: number; radius: number; seed: number; follow?: string;
  model: WorldModel | null; species?: string;
  roles: Record<string, THREE.Object3D | undefined>;
  /** hip height, body length (m, at scale 1) */
  hip: number; length: number; height: number;
  /** scale of this creature (herds scale their members; single entities take the layer's scale) */
  scale?: number;
  area?: V2[];
  // state (deterministic caches only; follow keeps a little smoothing state)
  plan?: Plan; world?: ReturnType<typeof surroundings>; cache?: RouteCache; homeKey?: string;
  followState?: { x: number; z: number; yaw: number; dist: number; t: number };
};

export function makeRig(obj: THREE.Object3D, o: Omit<Rig, 'roles' | 'hip' | 'length' | 'height'> & { box: [number, number, number] }): Rig {
  const roles: Rig['roles'] = {};
  obj.traverse((c) => { if (c.name.startsWith('role:')) roles[c.name.slice(5)] = c; });
  const hipRole = roles['leg.fl'] ?? roles['leg.l'];
  const hip = hipRole ? hipRole.position.y : o.box[1] * 0.4;
  const { box, ...rest } = o;
  return { ...rest, roles, hip, length: Math.max(box[0], box[2]), height: box[1] };
}

const WATER_KINDS = new Set<BehaviorKind>(['swim']);
const nocturnal = new Set(['fox', 'cat']);

/** One creature frame: behaviour → pose → gait. `base` gives the home (the entity's resting place). */
export function creatureStep(obj: THREE.Object3D, rig: Rig, entity: Entity | null, t: number, base: { y: number; yaw: number }, home?: V2) {
  const model = rig.model ?? boundModel;
  const s = rig.scale ?? obj.scale.x;
  const hx = home ? home[0] : obj.position.x, hz = home ? home[1] : obj.position.z;
  if (!model) { gait(obj, rig, idlePose(hx, hz, base.yaw), t, s, 0); return; }
  const key = `${hx.toFixed(2)},${hz.toFixed(2)},${rig.kind},${rig.radius},${rig.speed}`;
  if (rig.homeKey !== key || !rig.plan) {
    rig.homeKey = key;
    const medium = WATER_KINDS.has(rig.kind) ? 'water' : 'land';
    const skip = new Set<string>(entity ? [entity.id] : []);
    rig.plan = { kind: rig.kind, speed: rig.speed, radius: rig.radius, size: Math.max(0.12, rig.length * s * 0.35), seed: rig.seed, home: [hx, hz] };
    rig.world = surroundings(model, [hx, hz], rig.radius, medium, skip, rig.area);
    rig.cache = new RouteCache();
  }
  rig.world!.t = t;
  // night: diurnal animals sleep at home; fish and flyers keep going
  const night = nightOf(model);
  let kind = rig.kind;
  if (night > 0.6 && rig.gait !== 'fish-swim' && rig.gait !== 'bird-fly' && !nocturnal.has(rig.species ?? '') && kind !== 'swim') kind = 'sleep';
  let P: Pose;
  if (kind === 'follow' && rig.follow) P = followPose(rig, model, t, hx, hz);
  else if (kind !== rig.plan.kind) P = pose({ ...rig.plan, kind }, t, rig.world!, rig.cache!);
  else P = pose(rig.plan, t, rig.world!, rig.cache!);
  // vertical: ground, water surface, or flight altitude
  const g = model.terrain.sample(P.x, P.z), wl = waterAt(model, P.x, P.z);
  const homeG = model.terrain.sample(hx, hz);
  const lift = home ? 0 : base.y - Math.max(homeG, (rig.kind === 'swim' && wl !== null) ? wl : -Infinity);  // keep a placed-on-a-deck offset
  let y = g + Math.max(0, Number.isFinite(lift) ? lift : 0), floating = false;
  if (wl !== null && wl > g + 0.05) {
    floating = true;
    y = rig.gait === 'fish-swim' ? wl - rig.height * s * 0.95 : wl - rig.hip * s * 1.05;
  }
  if (rig.gait === 'bird-fly') y += P.alt;
  obj.position.set(P.x, y, P.z);
  // pitch the body along the slope it walks on (small)
  const ahead = 0.5 * rig.length * s, gx = model.terrain.sample(P.x + Math.sin(P.yaw) * ahead, P.z + Math.cos(P.yaw) * ahead);
  const pitch = floating || P.alt > 0.2 ? 0 : Math.max(-0.35, Math.min(0.35, -Math.atan2(gx - g, ahead)));
  obj.rotation.set(pitch, P.yaw, 0, 'YXZ');
  gait(obj, rig, P, t, s, floating ? 1 : 0);
}
function idlePose(x: number, z: number, yaw: number): Pose { return { x, z, yaw, speed: 0, dist: 0, rest: 1, activity: 'look', alt: 0, u: 0 }; }

function followPose(rig: Rig, model: WorldModel, t: number, hx: number, hz: number): Pose {
  const ref = model.get(rig.follow!);
  const st = rig.followState ??= { x: hx, z: hz, yaw: 0, dist: 0, t };
  const dt = Math.min(0.2, Math.max(0, t - st.t)); st.t = t;
  if (!ref) return idlePose(st.x, st.z, st.yaw);
  const wp = model.worldPose(ref), side = rand(rig.seed, 5) < 0.5 ? -1 : 1;
  const tx = wp.x + Math.sin(wp.yaw) * -1.4 + Math.cos(wp.yaw) * side * 0.9, tz = wp.z + Math.cos(wp.yaw) * -1.4 - Math.sin(wp.yaw) * side * 0.9;
  const dx = tx - st.x, dz = tz - st.z, d = Math.hypot(dx, dz);
  let sp = 0;
  if (d > 0.4) { sp = Math.min(rig.speed * (d > 4 ? 2.2 : 1), d / Math.max(dt, 1e-3)); const step = sp * dt; st.x += (dx / d) * step; st.z += (dz / d) * step; st.dist += step; const want = Math.atan2(dx, dz); st.yaw += (((want - st.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI) * Math.min(1, dt * 6); }
  return { x: st.x, z: st.z, yaw: st.yaw, speed: sp, dist: st.dist, rest: sp > 0.05 ? 0 : 1, activity: sp > 0.05 ? 'walk' : 'look', alt: 0, u: 0 };
}

const R = (rig: Rig, name: string) => rig.roles[name];
function setX(o: THREE.Object3D | undefined, v: number) { if (o) o.rotation.x = v; }

/** Pose the role pivots for the gait. `floating`: on water (paddle, no roll). Exported for the gallery studio. */
export function gait(obj: THREE.Object3D, rig: Rig, P: Pose, t: number, s: number, floating: number) {
  const sd = (rig.seed % 997) / 997 * Math.PI * 2;
  const nominal = Math.max(0.2, rig.speed);
  const m = Math.min(1, P.speed / (nominal * 0.6));                         // stride amplitude factor
  // swing amplitude by leg length (long legs swing less), and a stride (body travel per cycle) that
  // matches it — 4·hip·sin(amp) — so planted feet do not slide
  const legAmp = rig.gait === 'quadruped-walk' ? (rig.hip > 0.6 ? 0.34 : 0.42) : 0.5;
  const stride = Math.max(0.1, 4 * rig.hip * Math.sin(legAmp)) * s;
  const ph = (P.dist / stride) * Math.PI * 2 + sd;
  const breathe = Math.sin(t * (P.activity === 'sleep' ? 1.4 : 2.6) + sd);
  obj.scale.y = obj.scale.x * (1 + 0.012 * breathe);
  const head = R(rig, 'head'), tail = R(rig, 'tail');
  const turning = P.activity === 'turn' ? 1 : 0;
  switch (rig.gait) {
    case 'quadruped-walk': {
      const amp = legAmp * m + 0.12 * turning, tph = turning ? t * 9 : ph;
      // diagonal pairs: fore-left with hind-right, fore-right with hind-left
      setX(R(rig, 'leg.fl'), amp * Math.sin(tph)); setX(R(rig, 'leg.br'), amp * Math.sin(tph));
      setX(R(rig, 'leg.fr'), amp * Math.sin(tph + Math.PI)); setX(R(rig, 'leg.bl'), amp * Math.sin(tph + Math.PI));
      obj.position.y += (0.035 * rig.hip * s) * m * Math.cos(2 * ph);
      if (P.activity === 'sleep') {
        obj.position.y -= rig.hip * s * 0.72;
        setX(R(rig, 'leg.fl'), -1.35); setX(R(rig, 'leg.fr'), -1.35); setX(R(rig, 'leg.bl'), 1.35); setX(R(rig, 'leg.br'), 1.35);
      }
      if (head) {
        const graze = P.activity === 'graze' ? P.rest * (0.85 + 0.12 * Math.sin(t * 0.7 + sd)) : 0;
        const look = (P.activity === 'look' ? P.rest : 0) * 0.45 * Math.sin(t * 0.35 + sd);
        head.rotation.set(0.07 * m * Math.sin(2 * ph) + graze + (P.activity === 'sleep' ? 0.35 : 0) + 0.04 * (1 - m) * Math.sin(t * 1.3 + sd), look, 0, 'YXZ');
      }
      if (tail) { const wagF = rig.species === 'dog' || rig.species === 'pug' ? (m > 0.2 ? 7 : 11) : 1.6, wagA = rig.species === 'dog' || rig.species === 'pug' ? 0.45 : 0.2; tail.rotation.y = P.activity === 'sleep' ? 0 : wagA * Math.sin(t * wagF + sd); }
      break;
    }
    case 'biped-waddle': case 'bird-fly': {
      const flying = P.activity === 'fly';
      const amp = (floating ? 0.6 : 0.55) * m + 0.2 * turning, tph = floating ? t * 6 + sd : turning ? t * 10 : ph;
      setX(R(rig, 'leg.l'), flying ? -1.1 : amp * Math.sin(tph)); setX(R(rig, 'leg.r'), flying ? -1.1 : amp * Math.sin(tph + Math.PI));
      obj.rotation.z = floating || flying ? 0.03 * Math.sin(t * 1.1 + sd) : 0.09 * (m + turning * 0.5) * Math.sin(tph);
      if (!floating && !flying) obj.position.y += 0.02 * rig.hip * s * m * Math.abs(Math.sin(tph));
      if (floating) obj.position.y += 0.008 * s * Math.sin(t * 1.7 + sd);
      const wl = R(rig, 'wing.l'), wr = R(rig, 'wing.r');
      let flap = 0;
      if (flying) { const fast = (rig.species === 'seagull' ? 0.5 : 1) * (P.u < 0.25 || P.u > 0.8 ? 1 : 0.6); flap = 0.55 + 0.75 * Math.sin(t * (rig.species === 'seagull' ? 6 : 17) * fast + sd) * (rig.species === 'seagull' && P.u > 0.3 && P.u < 0.75 ? 0.25 : 1); }
      else if (P.activity === 'perch' || P.activity === 'look') flap = Math.max(0, Math.sin(t * 0.5 + sd)) ** 30 * 0.9 * Math.abs(Math.sin(t * 14));  // a stretch now and then
      if (wl) wl.rotation.z = flap; if (wr) wr.rotation.z = -flap;
      if (flying) obj.rotation.x = -0.12 * Math.cos(Math.PI * P.u);
      if (head) {
        const peck = (P.activity === 'graze' || (P.activity === 'perch' && !floating) ? P.rest : 0) * Math.max(0, Math.sin(t * 2.3 + sd)) ** 6 * 1.0;
        const look = (P.activity === 'look' ? P.rest : 0) * 0.6 * Math.sin(t * 0.6 + sd);
        head.rotation.set(peck + 0.12 * m * Math.sin(2 * tph) + (floating ? 0.04 * Math.sin(t * 2 + sd) : 0), look, 0, 'YXZ');
      }
      break;
    }
    case 'fish-swim': {
      const f = 2.5 + 6 * m;
      if (tail) tail.rotation.y = 0.45 * Math.sin(t * f + sd);
      obj.rotation.y += 0.06 * Math.sin(t * f + sd + Math.PI / 2);
      obj.position.y += 0.02 * s * Math.sin(t * 0.8 + sd);
      break;
    }
    case 'hover': obj.position.y += 0.1 * Math.sin(t * 1.5 + sd); break;
    default: break;
  }
}

// ---------------------------------------------------------------- routes and lights

/** Follow the entity's own path shape, or a ref entity's path (a road, a river), at `speed` m/s. */
function routeStep(obj: THREE.Object3D, e: Entity, def: StoredDef, model: WorldModel, t: number, base: { y: number; yaw: number }) {
  const r = def.components.route!;
  const refE = r.ref ? model.get(r.ref) : null;
  const shape = (refE?.shape ?? e.shape) as { path?: V2[] } | undefined;
  const path = shape?.path; if (!path || path.length < 2) return;
  const segs: number[] = []; let len = 0;
  for (let i = 1; i < path.length; i++) { const l = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); segs.push(l); len += l; }
  if (len < 1e-3) return;
  const closed = Math.hypot(path[0][0] - path[path.length - 1][0], path[0][1] - path[path.length - 1][1]) < 0.5;
  const off = rand(e.seed ?? seedOf(e.id), 1) * len;
  let d = t * r.speed + off;
  if (r.loop && closed) d = ((d % len) + len) % len;
  else { const q = ((d % (2 * len)) + 2 * len) % (2 * len); d = q > len ? 2 * len - q : q; }
  const pt = (dd: number): V2 => { let s = dd; for (let i = 0; i < segs.length; i++) { if (s <= segs[i] || i === segs.length - 1) { const k = segs[i] ? Math.min(1, Math.max(0, s / segs[i])) : 0; return [path[i][0] + (path[i + 1][0] - path[i][0]) * k, path[i][1] + (path[i + 1][1] - path[i][1]) * k]; } s -= segs[i]; } return path[path.length - 1]; };
  const p = pt(d), ahead = pt(Math.min(len, d + 2)), behind = pt(Math.max(0, d - 2));
  const g = model.terrain.sample(p[0], p[1]), wl = waterAt(model, p[0], p[1]);
  const floats = def.anchor === 'float' || def.tags.includes('boat');
  const y = (floats && wl !== null ? wl : g) + r.altitude;
  obj.position.set(p[0], y, p[1]);
  obj.rotation.y = Math.atan2(ahead[0] - behind[0], ahead[1] - behind[1]);
  void base;
}

/** Lamps glow at dusk and night; `state.on: false` darkens this one (its own material copy). */
function glowStep(obj: THREE.Object3D, e: Entity, model: WorldModel | null, t: number) {
  const ud = obj.userData as { glow?: THREE.Mesh[]; glowOff?: boolean };
  if (!ud.glow) { ud.glow = []; obj.traverse((c) => { const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m && (m as { emissive?: THREE.Color }).emissive && m.emissive.getHex() !== 0 && m.emissiveIntensity > 0) ud.glow!.push(c as THREE.Mesh); }); }
  const off = e.state?.on === false;
  if (off && !ud.glowOff) { ud.glowOff = true; for (const m of ud.glow) { const mat = (m.material as THREE.MeshStandardMaterial).clone(); mat.emissiveIntensity = 0; m.material = mat; } }
  if (off) return;
  const night = nightOf(model), level = 0.25 + 1.4 * night + 0.03 * Math.sin(t * 3);
  for (const m of ud.glow) (m.material as THREE.MeshStandardMaterial).emissiveIntensity = level;
}

function pointInPoly(px: number, pz: number, poly: [number, number][]) { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside; } return inside; }
function hash(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h >>> 0; }
