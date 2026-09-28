// Browser-side check of the engine camera planner against the real render
// (docs/engineering/CAMERA_VERIFY.md). The planner scores readability against
// obstacle prisms + bystander capsules (engine/camera/quality.ts); here the same
// sampled camera poses, subjects and subject points are ray-cast against the
// meshes the studio actually draws: the 2026 campus GLB and studio scenery
// (static, via a world-space triangle grid) and the take's engine parts and
// people (three.js Raycaster, skinned). A point is visible when it is framed
// (planner framing model: 16:9, safe-area band, 5 % margin) and the first hit
// is the subject's own mesh or nothing within distance − 0.1 m. Framing and size
// use the planner's formulas unchanged, so planner − real isolates occlusion.
import * as THREE from 'three';
import { isVisible } from '../../lib/three-resources';
import { takeSampler } from '../../engine/camera/take-sampler.ts';
import { DEFAULT_ASPECT, shotSubjects, subjectPoints, type ShotSpec, type SubjectPose } from '../../engine/camera/shots.ts';
import { CameraWorld } from '../../engine/camera/geom.ts';
import { readability, subjectGroup } from '../../engine/camera/quality.ts';
import type { Vec3 } from '../../engine/core/math.ts';
import type { SpatialScene } from '../../engine/spatial/types.ts';
import type { TakeReplay } from '../engine-view/take-replay.ts';

export type VerifyOpts = { fromT?: number; toT?: number; hz?: number; minSize?: number; tolerance?: number };
type Occ = { label: string; subject: string; points: number; crew: boolean };
export type VerifySample = {
  t: number;
  shot: string;
  key: string;
  planner: number;
  real: number;
  /** real, but hits on the subject's crew (carriers / co-workers) count as visible, as in the planner */
  realCrewExempt: number;
  /** the engine evaluator with no prisms (bystander capsules only): planner − noPrism = prism occlusion */
  noPrism: number;
  occluder: string | null;
  occluders: Occ[];
  camera: Vec3;
  target: Vec3;
  fov: number;
  subjects: { id: string; real: number; visible: string }[];
};

const DEG = Math.PI / 180;
const SKIP_GROUPS = new Set(['Static render batches']);

/** Human-readable name for a static mesh: up to three named ancestors, outermost first. */
function meshLabel(o: THREE.Object3D): string {
  const names: string[] = [];
  for (let p: THREE.Object3D | null = o; p && !(p instanceof THREE.Scene); p = p.parent) if (p.name) names.push(p.name);
  if (!names.length) return `${o.type} (unnamed)`;
  const out = names.length > 3 ? [names.at(-1)!, '…', names[1], names[0]] : names.reverse();
  return out.join(' / ');
}

/** Can a mesh block sight in the render? (see-through, hidden and inside-out meshes cannot) */
/** Outermost named ancestor below the scene (for the inventory). */
function rootName(o: THREE.Object3D): string {
  let name = '';
  for (let p: THREE.Object3D | null = o; p && !(p instanceof THREE.Scene); p = p.parent) if (p.name) name = p.name;
  return name || '(unnamed)';
}

function opaque(o: THREE.Mesh, skipped: Record<string, number>): boolean {
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  const why = !isVisible(o) ? 'hidden'
    : mats.every((m) => !m.visible) ? 'material hidden'
    : mats.every((m) => m.transparent && m.opacity < 0.6) ? 'transparent'
    : mats.every((m) => m.side === THREE.BackSide) ? 'backside'
    : !(o.layers.isEnabled(0) || o.layers.isEnabled(1)) ? 'layer'
    : null;
  if (why) { const k = `${why}: ${rootName(o)}`; skipped[k] = (skipped[k] ?? 0) + 1; }
  return !why;
}

/**
 * Static triangles in world space bucketed on an x/z grid; segment queries walk the
 * cells along the segment (2D DDA) with mailboxing and stop once a cell starts beyond
 * the best hit. Built once per verification run over the region the track covers.
 */
class TriangleGrid {
  tri: Float32Array;
  obj: Int32Array;
  mail: Int32Array;
  cells: Int32Array[];
  objects: THREE.Mesh[] = [];
  n = 0;
  ray = 0;
  constructor(meshes: THREE.Mesh[], readonly x0: number, readonly z0: number, readonly nx: number, readonly nz: number, readonly cell: number, box: THREE.Box3) {
    const tris: number[] = [], objs: number[] = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), tb = new THREE.Box3();
    for (const m of meshes) {
      const g = m.geometry, pos = g.attributes.position as THREE.BufferAttribute | undefined;
      if (!pos) continue;
      const wb = (g.boundingBox ?? (g.computeBoundingBox(), g.boundingBox!)).clone().applyMatrix4(m.matrixWorld);
      if (!wb.intersectsBox(box)) continue;
      const oi = this.objects.push(m) - 1;
      const idx = g.index;
      const count = idx ? idx.count : pos.count;
      const s0 = Math.max(0, g.drawRange.start), s1 = Math.min(count, g.drawRange.start + g.drawRange.count);
      for (let i = s0; i + 2 < s1; i += 3) {
        const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
        a.fromBufferAttribute(pos, i0).applyMatrix4(m.matrixWorld);
        b.fromBufferAttribute(pos, i1).applyMatrix4(m.matrixWorld);
        c.fromBufferAttribute(pos, i2).applyMatrix4(m.matrixWorld);
        tb.makeEmpty().expandByPoint(a).expandByPoint(b).expandByPoint(c);
        if (!tb.intersectsBox(box)) continue;
        tris.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
        objs.push(oi);
      }
    }
    this.tri = new Float32Array(tris);
    this.obj = new Int32Array(objs);
    this.n = objs.length;
    this.mail = new Int32Array(this.n).fill(-1);
    const lists: number[][] = Array.from({ length: nx * nz }, () => []);
    const T = this.tri;
    for (let k = 0; k < this.n; k++) {
      const o = k * 9;
      const mnx = Math.min(T[o], T[o + 3], T[o + 6]), mxx = Math.max(T[o], T[o + 3], T[o + 6]);
      const mnz = Math.min(T[o + 2], T[o + 5], T[o + 8]), mxz = Math.max(T[o + 2], T[o + 5], T[o + 8]);
      const cx0 = Math.max(0, Math.floor((mnx - x0) / cell)), cx1 = Math.min(nx - 1, Math.floor((mxx - x0) / cell));
      const cz0 = Math.max(0, Math.floor((mnz - z0) / cell)), cz1 = Math.min(nz - 1, Math.floor((mxz - z0) / cell));
      for (let i = cx0; i <= cx1; i++) for (let j = cz0; j <= cz1; j++) lists[j * nx + i].push(k);
    }
    this.cells = lists.map((l) => Int32Array.from(l));
  }

  /** Triangles in the region per outermost named ancestor. */
  roots() {
    const out: Record<string, number> = {};
    for (let k = 0; k < this.n; k++) { const r = rootName(this.objects[this.obj[k]]); out[r] = (out[r] ?? 0) + 1; }
    return out;
  }

  /** First hit on segment o + d·s, s ∈ (0, len] (d unit): {s, object} or null. */
  cast(o: Vec3, d: Vec3, len: number): { s: number; object: THREE.Mesh } | null {
    const ray = ++this.ray, T = this.tri, cell = this.cell;
    let best = len, bestK = -1;
    const test = (list: Int32Array) => {
      for (let q = 0; q < list.length; q++) {
        const k = list[q];
        if (this.mail[k] === ray) continue;
        this.mail[k] = ray;
        const i = k * 9;
        // Möller–Trumbore, double-sided
        const e1x = T[i + 3] - T[i], e1y = T[i + 4] - T[i + 1], e1z = T[i + 5] - T[i + 2];
        const e2x = T[i + 6] - T[i], e2y = T[i + 7] - T[i + 1], e2z = T[i + 8] - T[i + 2];
        const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det;
        const tx = o[0] - T[i], ty = o[1] - T[i + 1], tz = o[2] - T[i + 2];
        const u = (tx * px + ty * py + tz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const s = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (s > 1e-4 && s < best) { best = s; bestK = k; }
      }
    };
    // 2D DDA over x/z cells along the segment
    const hx = d[0], hz = d[2];
    let ix = Math.floor((o[0] - this.x0) / cell), iz = Math.floor((o[2] - this.z0) / cell);
    const sx = hx > 0 ? 1 : -1, sz = hz > 0 ? 1 : -1;
    const dX = Math.abs(hx) > 1e-12 ? Math.abs(cell / hx) : Infinity, dZ = Math.abs(hz) > 1e-12 ? Math.abs(cell / hz) : Infinity;
    let nX = Math.abs(hx) > 1e-12 ? ((this.x0 + (ix + (hx > 0 ? 1 : 0)) * cell - o[0]) / hx) : Infinity;
    let nZ = Math.abs(hz) > 1e-12 ? ((this.z0 + (iz + (hz > 0 ? 1 : 0)) * cell - o[2]) / hz) : Infinity;
    let enter = 0;
    for (let guard = 0; guard < 100000 && enter <= best; guard++) {
      if (ix >= 0 && iz >= 0 && ix < this.nx && iz < this.nz) test(this.cells[iz * this.nx + ix]);
      if (nX < nZ) { enter = nX; nX += dX; ix += sx; } else { enter = nZ; nZ += dZ; iz += sz; }
      if (enter === Infinity) break;
    }
    return bestK >= 0 ? { s: best, object: this.objects[this.obj[bestK]] } : null;
  }
}

/** Planner framing model (quality.ts `basis`/`toCam`), duplicated so each point's framing is known. */
function framer(position: Vec3, target: Vec3, fov: number, aspect: number) {
  const d = [target[0] - position[0], target[1] - position[1], target[2] - position[2]];
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  const f = [d[0] / l, d[1] / l, d[2] / l];
  let r = [-f[2], 0, f[0]];
  const rl = Math.hypot(r[0], r[2]);
  r = rl > 1e-9 ? [r[0] / rl, 0, r[2] / rl] : [1, 0, 0];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const tv = Math.tan((fov * DEG) / 2), th = tv * aspect;
  const cam = (p: Vec3): Vec3 => {
    const q = [p[0] - position[0], p[1] - position[1], p[2] - position[2]];
    return [q[0] * r[0] + q[1] * r[1] + q[2] * r[2], q[0] * u[0] + q[1] * u[1] + q[2] * u[2], q[0] * f[0] + q[1] * f[1] + q[2] * f[2]];
  };
  return { tv, th, cam };
}

/** Planner size term (quality.ts): subject extent at its bbox-centre depth, as fraction of frame height. */
function sizeOf(s: SubjectPose, pts: Vec3[], fr: ReturnType<typeof framer>, near: number) {
  const hgt = s.height ?? 1.75;
  const lo: Vec3 = [s.p[0], s.p[1], s.p[2]], hi: Vec3 = [s.p[0], s.p[1] + hgt, s.p[2]];
  const plo = [Infinity, Infinity, Infinity], phi = [-Infinity, -Infinity, -Infinity];
  for (const q of pts) for (let j = 0; j < 3; j++) {
    plo[j] = Math.min(plo[j], q[j]); phi[j] = Math.max(phi[j], q[j]);
    lo[j] = Math.min(lo[j], q[j]); hi[j] = Math.max(hi[j], q[j]);
  }
  const extent = Math.max(hgt, Math.hypot(phi[0] - plo[0], phi[1] - plo[1], phi[2] - plo[2]));
  const depth = Math.max(near, fr.cam([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2])[2]);
  return extent / (2 * depth * fr.tv);
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const v2 = (v: Vec3): Vec3 => [r4(v[0]), r4(v[1]), r4(v[2])];

/**
 * Run the verification over the replay's camera track. Seeks the replay (paused) to each
 * sampled time, casts rays, then restores the previous time. Yields to the page every few
 * samples so rendering and tests stay responsive.
 */
export async function verifyCamera(scene: THREE.Scene, replay: TakeReplay, opts: VerifyOpts = {}) {
  const started = performance.now();
  const data = replay.track as typeof replay.track & { shots?: { label: string; t0: number; t1: number; spec: ShotSpec }[] };
  const trackHz = data.hz, hz = opts.hz ?? 2, tol = opts.tolerance ?? 0.1, minSize = opts.minSize ?? 0.08, near = 0.1;
  const fromT = opts.fromT ?? 0, toT = opts.toT ?? replay.duration;
  const stride = Math.max(1, Math.round(trackHz / hz));
  const picked = data.samples.filter((s, i) => i % stride === 0 && s.t >= fromT - 1e-9 && s.t <= toT + 1e-9);
  const shots = data.shots ?? [{ label: 'track', t0: 0, t1: Infinity, spec: data.spec }];
  const shotAt = (t: number) => shots.find((s) => t >= s.t0 && t < s.t1) ?? shots.at(-1)!;
  const safeBottom = data.safeArea?.bottom ?? 0;
  const yMin = 2 * safeBottom - 0.95;
  const entityIds = new Set(Object.keys(replay.take.finalState.entities));
  const kindOf = (id: string) => replay.take.finalState.entities[id]?.kind ?? 'human';
  const sampler = takeSampler(replay.take);

  // region the rays can reach: every sampled camera position and subject point (+ margin)
  const region = new THREE.Box3();
  for (const s of picked) {
    region.expandByPoint(new THREE.Vector3(...s.position));
    for (const id of shotSubjects(shotAt(s.t).spec)) {
      const subj = sampler(s.t)[id];
      if (subj) for (const p of subjectPoints(subj)) region.expandByPoint(new THREE.Vector3(...p));
    }
  }
  region.expandByScalar(2);

  // static meshes → triangle grid; skinned / instanced meshes outside the take → Raycaster
  const skipped: Record<string, number> = {};
  const statics: THREE.Mesh[] = [], extras: THREE.Object3D[] = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (o === replay.group || !(o as THREE.Mesh).isMesh) return;
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === replay.group || SKIP_GROUPS.has(p.name)) return;
    const m = o as THREE.Mesh;
    if (!opaque(m, skipped)) return;
    if ((m as THREE.SkinnedMesh).isSkinnedMesh || (m as THREE.InstancedMesh).isInstancedMesh) extras.push(m);
    else statics.push(m);
  });
  const cell = 1.5;
  const nx = Math.max(1, Math.ceil((region.max.x - region.min.x) / cell)), nz = Math.max(1, Math.ceil((region.max.z - region.min.z) / cell));
  const grid = new TriangleGrid(statics, region.min.x, region.min.z, nx, nz, cell, region);
  const buildMs = performance.now() - started;
  // control: a vertical ray down through the site must hit the static ground/campus meshes
  const c = region.getCenter(new THREE.Vector3());
  const ground = grid.cast([c.x, region.max.y, c.z], [0, -1, 0], region.max.y - region.min.y);

  const noPrismWorld = new CameraWorld({ obstacles: [], bounds: [region.min.x, region.min.z, region.max.x, region.max.z] } as unknown as SpatialScene);
  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3(), dir = new THREE.Vector3();
  const prevT = replay.t, prevPlaying = replay.playing;
  replay.playing = false;

  // owner entity id of a take mesh (ComponentViews names parts by id, HumanViews names rig holders by id)
  const ownerOf = (o: THREE.Object3D): string | null => {
    for (let p: THREE.Object3D | null = o; p && p !== replay.group; p = p.parent) if (p.name && entityIds.has(p.name)) return p.name;
    return null;
  };

  const out: VerifySample[] = [];
  const occTotals = new Map<string, { points: number; samples: Set<number> }>();
  let frameMismatch = 0, rays = 0;
  for (let n = 0; n < picked.length; n++) {
    const s = picked[n];
    replay.seek(s.t);
    replay.update(0);
    replay.group.updateMatrixWorld(true);
    const dyn: THREE.Object3D[] = [...extras];
    replay.group.traverse((o) => { if ((o as THREE.Mesh).isMesh && isVisible(o)) dyn.push(o); });
    const shot = shotAt(s.t);
    const ids = shotSubjects(shot.spec);
    const subjects = sampler(s.t);
    const group = subjectGroup(subjects, ids);
    const fr = framer(s.position, s.target, s.fov, DEFAULT_ASPECT);
    let wsum = 0, total = 0, totalCrew = 0, cutawayCheck = 0;
    const occ = new Map<string, Occ>();
    const per: VerifySample['subjects'] = [];
    for (const id of ids) {
      const subj = subjects[id];
      if (!subj) { wsum += 1; per.push({ id, real: 0, visible: 'missing' }); continue; }
      const pts = subjectPoints(subj);
      let vis = 0, visCrew = 0, framedN = 0;
      for (const p of pts) {
        const c = fr.cam(p);
        const framed = c[2] > near && Math.abs(c[0]) <= c[2] * fr.th * 0.95 && c[1] <= c[2] * fr.tv * 0.95 && c[1] >= c[2] * fr.tv * yMin;
        if (!framed) continue;
        framedN++;
        const dist = Math.hypot(p[0] - s.position[0], p[1] - s.position[1], p[2] - s.position[2]);
        const len = dist - tol;
        if (len <= 0) { vis++; visCrew++; continue; }
        const d: Vec3 = [(p[0] - s.position[0]) / dist, (p[1] - s.position[1]) / dist, (p[2] - s.position[2]) / dist];
        rays++;
        const st = grid.cast(s.position, d, len);
        origin.fromArray(s.position); dir.fromArray(d);
        raycaster.set(origin, dir);
        raycaster.near = 0;
        raycaster.far = st ? st.s : len;
        const dh = raycaster.intersectObjects(dyn, false)[0];
        let label: string | null = null, crew = false;
        if (dh) {
          const owner = ownerOf(dh.object);
          if (owner === id) label = null; // own mesh first: visible
          else if (owner) { label = `${kindOf(owner) === 'component' ? 'part' : 'person'} ${owner}`; crew = group.has(owner); }
          else label = meshLabel(dh.object);
        } else if (st) label = meshLabel(st.object);
        if (!label) { vis++; visCrew++; continue; }
        if (crew) visCrew++;
        const key = `${id}|${label}`;
        const e = occ.get(key) ?? { label, subject: id, points: 0, crew };
        e.points++;
        occ.set(key, e);
      }
      const size = sizeOf(subj, pts, fr, near);
      const k = Math.min(1, size / minSize), npts = pts.length, w = subj.weight ?? 1;
      wsum += w;
      total += w * (vis / npts) * k;
      totalCrew += w * (visCrew / npts) * k;
      cutawayCheck += w * (framedN / npts) * k;
      per.push({ id, real: r4((vis / npts) * k), visible: `${vis}/${npts}` });
    }
    const real = wsum > 0 ? total / wsum : 1, realCrewExempt = wsum > 0 ? totalCrew / wsum : 1;
    const cam = { position: s.position, target: s.target, fov: s.fov };
    const opt = { minSize, safeBottom };
    // self-check: our framing/size model equals the engine's (cutaway = no occlusion at all)
    const engineCutaway = readability(noPrismWorld, cam, subjects, ids, { ...opt, cutaway: true }).score;
    if (Math.abs(engineCutaway - (wsum > 0 ? cutawayCheck / wsum : 1)) > 1e-6) frameMismatch++;
    const noPrism = readability(noPrismWorld, cam, subjects, ids, opt).score;
    const occluders = [...occ.values()].sort((a, b) => b.points - a.points);
    for (const o of occluders) {
      const e = occTotals.get(o.label) ?? { points: 0, samples: new Set<number>() };
      e.points += o.points; e.samples.add(n);
      occTotals.set(o.label, e);
    }
    out.push({
      t: s.t, shot: shot.label, key: s.key, planner: s.readability, real: r4(real), realCrewExempt: r4(realCrewExempt), noPrism: r4(noPrism),
      occluder: occluders[0]?.label ?? null, occluders, camera: v2(s.position), target: v2(s.target), fov: s.fov, subjects: per,
    });
    if (n % 8 === 7) await new Promise((r) => setTimeout(r, 0));
  }
  replay.seek(prevT);
  replay.playing = prevPlaying;
  replay.update(0);

  const mean = (f: (x: VerifySample) => number) => r4(out.reduce((a, x) => a + f(x), 0) / Math.max(1, out.length));
  const diff = (x: VerifySample) => x.planner - x.real;
  const hidden = out.filter((x) => x.planner >= 0.8 && x.real <= 0.3);
  const slim = (x: VerifySample) => ({ t: x.t, shot: x.shot, key: x.key, planner: x.planner, real: x.real, realCrewExempt: x.realCrewExempt, noPrism: x.noPrism, occluder: x.occluder, occluders: x.occluders.slice(0, 4), camera: x.camera, target: x.target, fov: x.fov, subjects: x.subjects });
  const byShot: Record<string, { samples: number; meanPlanner: number; meanReal: number; meanRealCrewExempt: number }> = {};
  for (const sh of shots) {
    const xs = out.filter((x) => x.shot === sh.label);
    if (!xs.length) continue;
    const m = (f: (x: VerifySample) => number) => r4(xs.reduce((a, x) => a + f(x), 0) / xs.length);
    byShot[sh.label] = { samples: xs.length, meanPlanner: m((x) => x.planner), meanReal: m((x) => x.real), meanRealCrewExempt: m((x) => x.realCrewExempt) };
  }
  return {
    schema: 'mars-camera-verify/1',
    take: replay.take.id,
    track: replay.file.camera.id,
    hz, fromT, toT, tolerance: tol,
    samples: out.length,
    meanPlanner: mean((x) => x.planner),
    meanReal: mean((x) => x.real),
    meanRealCrewExempt: mean((x) => x.realCrewExempt),
    meanNoPrism: mean((x) => x.noPrism),
    maxAbsDiff: r4(Math.max(0, ...out.map((x) => Math.abs(diff(x))))),
    minReal: r4(Math.min(1, ...out.map((x) => x.real))),
    hiddenByRealMesh: { rule: 'planner >= 0.8 && real <= 0.3', count: hidden.length, samples: hidden.map(slim) },
    realWorse: { rule: 'planner - real >= 0.2', count: out.filter((x) => diff(x) >= 0.2).length },
    overConservative: {
      strict: { rule: 'planner <= 0.3 && real >= 0.8', count: out.filter((x) => x.planner <= 0.3 && x.real >= 0.8).length },
      soft: { rule: 'real - planner >= 0.2', count: out.filter((x) => -diff(x) >= 0.2).length },
      top: [...out].sort((a, b) => diff(a) - diff(b)).slice(0, 5).filter((x) => diff(x) < 0).map(slim),
    },
    worst: [...out].sort((a, b) => diff(b) - diff(a) || a.t - b.t).slice(0, 10).map(slim),
    byShot,
    occluders: [...occTotals.entries()].map(([label, e]) => ({ label, points: e.points, samples: e.samples.size })).sort((a, b) => b.samples - a.samples).slice(0, 25),
    selfCheck: { frameModelMismatch: frameMismatch, groundRay: ground ? { label: meshLabel(ground.object), y: r4(region.max.y - ground.s) } : null },
    scene: { roots: grid.roots(), staticMeshes: grid.objects.length, staticTriangles: grid.n, rayExtras: extras.length, skipped, region: { min: v2(region.min.toArray()), max: v2(region.max.toArray()) }, cell },
    perf: { buildMs: Math.round(buildMs), totalMs: Math.round(performance.now() - started), rays },
    all: out.map((x) => [x.t, x.planner, x.real, x.realCrewExempt]),
  };
}
export type CameraVerifyReport = Awaited<ReturnType<typeof verifyCamera>>;
