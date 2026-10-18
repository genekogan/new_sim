// scatter/2 and orchard/1 mesh halves: one InstancedMesh per species (≤ 16 draws for a whole
// forest), per-instance tone and size from the seed. A palette entry with `def` instances that
// def's own mesh half (any kit tree, rock or flower) instead of a built-in species. Exclusions
// come from the model: solids (footprints), roads/paths/plazas/pitches (surfaces), buildings.
// Owner: L3.
import { centreLine, orchardPoints, paletteOf, queryOf, scatter2Points, type ScatterPoint } from '@sim/generators';
import type { Entity, WorldModel } from '@sim/world-compiler';
import * as THREE from 'three';
import { meshFor, registerMesh, type MeshCtx } from './registry.ts';
import { blockTest, type BlockCells, type BlockShape } from './block-test.ts';
import { speciesGeometry } from './species.ts';
import { vertexMaterial } from './soup.ts';

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** The blocked-ground index is the same for every scatter in one world state: built once per model revision (Eden 2026's
 * ~240 woodlands each rebuilt it over all ~3,800 entities, ~18 s of first frame), keyed by the model's safety cache key. */
const blockIndex = new WeakMap<object, { pad: number; cells: BlockCells }>();
export const BLOCK_CELL = 16;
/** The blocked-ground cells of a model (solid footprints and paved / road surfaces), cached per model revision. */
export function blockCellsOf(model: WorldModel, pad = 0.6): BlockCells {
  const key = model.safetyCacheKey(), hit = blockIndex.get(key);
  const cells = hit && hit.pad === pad ? hit.cells : model.readPass(() => blockCells(model, pad, BLOCK_CELL));
  if (!hit || hit.pad !== pad) blockIndex.set(key, { pad, cells });
  return cells;
}
/** A spatial test for "something is already here": solid footprints and paved / road surfaces (block-test.ts). */
export function blockedBy(model: WorldModel, self: Entity, pad = 0.6): (x: number, z: number) => boolean {
  return blockTest(blockCellsOf(model, pad), BLOCK_CELL, self.id);
}
function blockCells(model: WorldModel, pad: number, C: number): BlockCells {
  const cells = new Map<string, BlockShape[]>();
  const put = (x0: number, z0: number, x1: number, z1: number, s: BlockShape) => { for (let gz = Math.floor(z0 / C); gz <= Math.floor(z1 / C); gz++) for (let gx = Math.floor(x0 / C); gx <= Math.floor(x1 / C); gx++) { const k = `${gx},${gz}`; const l = cells.get(k); if (l) l.push(s); else cells.set(k, [s]); } };
  for (const e of model.entities.values()) {
    const d = model.resolvedDef(e.def); if (!d) continue;
    const gen = d.make.kind === 'gen' ? d.make.gen : '';
    if (gen === 'scatter/1' || gen === 'scatter/2' || gen === 'landform/1' || gen === 'lake/1' || gen === 'river/1' || gen.startsWith('cliff') || gen.startsWith('terrace') || gen.startsWith('brush') || gen.startsWith('channel') || gen === 'lawn/1' || gen === 'shore/1') continue;
    if ((gen === 'road/1' || gen === 'path/1') && e.shape && 'path' in e.shape) {
      const c = centreLine(e.shape), w = num(e.params?.width, gen === 'road/1' ? 6 : 1.6) + 2 * (num(e.params?.shoulder, gen === 'road/1' ? 0.6 : 0)) + pad * 2;
      for (let i = 1; i < c.length; i++) put(Math.min(c[i - 1][0], c[i][0]) - w, Math.min(c[i - 1][1], c[i][1]) - w, Math.max(c[i - 1][0], c[i][0]) + w, Math.max(c[i - 1][1], c[i][1]) + w, { kind: 'line', c: [c[i - 1], c[i]], w: w / 2, id: e.id });
      continue;
    }
    if (e.shape && 'area' in e.shape && (gen === 'plaza/1' || gen === 'pitch/1' || gen === 'parking/1' || gen === 'deck/1' || gen === 'garden-bed/1' || gen === 'orchard/1')) {
      const p = e.shape.area as [number, number][]; let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const [x, z] of p) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
      put(x0 - pad, z0 - pad, x1 + pad, z1 + pad, { kind: 'poly', p, id: e.id }); continue;
    }
    // a building's whole floor plan is blocked, not only its walls: no flowers or saplings growing indoors
    if (gen === 'building/1') { const fp = model.footprint(e, d), yaw = model.worldPose(e).yaw, co = Math.cos(yaw), si = Math.sin(yaw); let a0 = Infinity, b0 = Infinity, a1 = -Infinity, b1 = -Infinity, cx = 0, cz = 0;
      for (const o of fp) { cx += o.c[0] / fp.length; cz += o.c[1] / fp.length; }
      for (const o of fp) { const oc = Math.cos(o.yaw), os = Math.sin(o.yaw); for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const x = o.c[0] + i * o.half[0] * oc + j * o.half[1] * os - cx, z = o.c[1] - i * o.half[0] * os + j * o.half[1] * oc - cz, a = x * co - z * si, b = x * si + z * co; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); } }
      if (fp.length) { const ma = (a0 + a1) / 2, mb = (b0 + b1) / 2, c: [number, number] = [cx + ma * co + mb * si, cz - ma * si + mb * co], h: [number, number] = [(a1 - a0) / 2 + pad, (b1 - b0) / 2 + pad], r = Math.hypot(h[0], h[1]); put(c[0] - r, c[1] - r, c[0] + r, c[1] + r, { kind: 'obb', c, h, yaw, id: e.id }); }
    }
    for (const o of model.footprint(e, d)) { const r = Math.hypot(o.half[0], o.half[1]) + pad; put(o.c[0] - r, o.c[1] - r, o.c[0] + r, o.c[1] + r, { kind: 'obb', c: o.c, h: [o.half[0] + pad, o.half[1] + pad], yaw: o.yaw, id: e.id }); }
  }
  return cells;
}

const tint = new THREE.Color();
function instance(group: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], pts: { x: number; y: number; z: number; s: number; yaw: number; tone: number; sink?: number }[], name: string, local?: THREE.Matrix4) {
  if (!pts.length) return;
  const im = new THREE.InstancedMesh(geo, mat, pts.length), m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  pts.forEach((p, i) => { q.setFromAxisAngle(up, p.yaw); m.compose(new THREE.Vector3(p.x, p.y - (p.sink ?? 0) * p.s, p.z), q, new THREE.Vector3(p.s, p.s, p.s)); if (local) m.multiply(local); im.setMatrixAt(i, m); tint.setRGB(0.85 + p.tone * 0.3, 0.88 + p.tone * 0.24, 0.85 + p.tone * 0.25); im.setColorAt(i, tint); });
  im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.castShadow = true; im.receiveShadow = true; im.name = name; im.computeBoundingSphere(); im.userData.cameraTransparent = true;
  group.add(im);
}

/** Instance an arbitrary def's mesh half (palette entry with `def`): each Mesh in its object becomes one InstancedMesh. */
function instanceDef(group: THREE.Group, ctx: MeshCtx, ref: string, pts: { x: number; y: number; z: number; s: number; yaw: number; tone: number }[]): boolean {
  const def = ctx.model.resolvedDef(ref); if (!def) return false;
  const b = meshFor(def); if (!b || b.world) return false;
  const fake = { id: `${ctx.entity.id}:${ref}`, def: def.ref, in: { parent: 'world' }, by: 'viewer', born: 0, v: 1 } as Entity;
  const obj = b.build({ ...ctx, def, entity: fake, params: {}, args: def.make.kind === 'gen' ? ((def.make.args ?? {}) as Record<string, unknown>) : {}, baked: ctx.model.bake(def, {}, 0), tint: (_k, f) => f });
  if (!obj) return false;
  obj.updateMatrixWorld(true);
  obj.traverse((o) => { const mesh = o as THREE.Mesh; if (mesh.isMesh && !(mesh as unknown as THREE.InstancedMesh).isInstancedMesh) instance(group, mesh.geometry, mesh.material, pts, `scatter:${ref}`, mesh.matrixWorld.clone()); });
  return true;
}

function ground(ctx: MeshCtx) { return (x: number, z: number) => ctx.model.terrain.sample(x, z); }

registerMesh({
  gen: 'scatter/2', world: true,
  build(ctx) {
    const e = ctx.entity; if (!e.shape || !('area' in e.shape)) return null;
    const pal = paletteOf(ctx.params);
    const pts: ScatterPoint[] = scatter2Points(e.shape.area as [number, number][], ctx.params, e.seed ?? hashSeed(e.id), queryOf(ctx.model), blockedBy(ctx.model, e));
    const group = new THREE.Group(); group.name = `scatter ${e.name ?? e.id}`;
    const g = ground(ctx), byK = new Map<number, { x: number; y: number; z: number; s: number; yaw: number; tone: number; sink?: number }[]>();
    for (const p of pts) { const l = byK.get(p.k) ?? []; const kind = pal[p.k].kind; const y = g(p.x, p.z); l.push({ x: p.x, y, z: p.z, s: p.s, yaw: p.yaw, tone: p.tone, sink: pal[p.k].def ? 0 : kind === 'rock' || kind === 'boulder' ? 0.15 : 0.05 }); byK.set(p.k, l); }
    for (const [k, list] of byK) {
      const entry = pal[k];
      if (entry.def && instanceDef(group, ctx, entry.def, list)) continue;
      instance(group, speciesGeometry(entry.kind ?? 'oak'), vertexMaterial(), list, `scatter:${entry.kind ?? 'oak'}`);
    }
    group.userData.points = pts.length;
    return group.children.length ? group : null;
  },
});

registerMesh({
  gen: 'orchard/1', world: true,
  build(ctx) {
    const e = ctx.entity; if (!e.shape || !('area' in e.shape)) return null;
    const pts = orchardPoints(e.shape.area as [number, number][], num(ctx.params.spacing, 5), e.seed ?? 0), g = ground(ctx), h = num(ctx.params.height, 4.5) / 4.2;
    const group = new THREE.Group(); group.name = `orchard ${e.name ?? e.id}`;
    instance(group, speciesGeometry(String(ctx.params.species ?? 'apple')), vertexMaterial(), pts.map((p, i) => ({ x: p.x, y: g(p.x, p.z), z: p.z, s: p.s * h, yaw: i * 2.39, tone: (i * 0.618) % 1, sink: 0.05 })), 'orchard-trees');
    return group;
  },
});
function hashSeed(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0) % 100000; }
