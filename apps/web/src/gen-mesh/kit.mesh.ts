// kit/2 mesh half: rounded low-poly primitives merged into few draws; parts with a `role` stay
// separate under pivot groups so creature gaits and spinning wheels can move them. Owner: L1.
// Geometry is cached per (def hash, palette) so many instances share one BufferGeometry.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { kitArgs, type KitArgs, type KitShape } from '@sim/generators';
import { registerMesh, type MeshCtx } from './registry.ts';

const cache = new Map<string, THREE.Object3D>();

/** Geometry for one primitive, centred where its kind is naturally centred; caller transforms. */
function primitive(sh: KitShape, round: number): THREE.BufferGeometry {
  const seg = sh.segments ?? 10;
  switch (sh.kind) {
    case 'box': case 'rbox': {
      const [w, h, d] = sh.size ?? [1, 1, 1];
      const r = Math.min(sh.round ?? (sh.kind === 'rbox' ? Math.max(round, 0.06) : round), Math.min(w, h, d) / 2 - 1e-4);
      return r > 0.005 ? new RoundedBoxGeometry(w, h, d, 1, r) : new THREE.BoxGeometry(w, h, d);
    }
    case 'cyl': return new THREE.CylinderGeometry(sh.r2 ?? sh.r ?? 0.5, sh.r ?? 0.5, sh.h ?? 1, seg);
    case 'cone': return new THREE.ConeGeometry(sh.r ?? 0.5, sh.h ?? 1, seg);
    case 'capsule': return new THREE.CapsuleGeometry(sh.r ?? 0.2, sh.h ?? 0.6, 2, Math.max(6, Math.min(seg, 10)));
    case 'sphere': return new THREE.SphereGeometry(sh.r ?? 0.5, seg, Math.max(4, Math.round(seg * 0.6)));
    case 'torus': return new THREE.TorusGeometry(sh.r ?? 0.5, sh.r2 ?? 0.1, 6, seg, sh.arc ?? Math.PI * 2);
    case 'ring': { const g = new THREE.TorusGeometry(sh.r ?? 0.5, sh.r2 ?? 0.1, 6, seg, sh.arc ?? Math.PI * 2); g.rotateX(Math.PI / 2); return g; }
    case 'wedge': {
      const [w, h, d] = sh.size ?? [1, 1, 1];
      const s = new THREE.Shape([new THREE.Vector2(-d / 2, -h / 2), new THREE.Vector2(d / 2, -h / 2), new THREE.Vector2(-d / 2, h / 2)]);
      const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: round > 0.005, bevelSize: Math.min(round, 0.03), bevelThickness: Math.min(round, 0.03), bevelSegments: 1 });
      g.translate(0, 0, -w / 2); g.rotateY(-Math.PI / 2); return g;
    }
    case 'arch': {
      const [w, h, d] = sh.size ?? [2, 2, 0.3]; const t = Math.min(w, h) * 0.18, rIn = w / 2 - t, spring = h - w / 2;
      const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(-w / 2, spring); s.absarc(0, spring, w / 2, Math.PI, 0, true); s.lineTo(w / 2, 0); s.lineTo(w / 2 - t, 0); s.lineTo(w / 2 - t, spring); s.absarc(0, spring, rIn, 0, Math.PI, false); s.lineTo(-w / 2 + t, 0); s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: Math.max(6, seg) }); g.translate(0, -h / 2, -d / 2); return g;
    }
    case 'lathe': return new THREE.LatheGeometry((sh.profile ?? [[0.5, 0], [0.5, 1]]).map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), seg);
    case 'extrude': {
      const s = new THREE.Shape((sh.polygon ?? [[0, 0], [1, 0], [0, 1]]).map(([x, z]) => new THREE.Vector2(x, z)));
      const g = new THREE.ExtrudeGeometry(s, { depth: sh.h ?? 0.2, bevelEnabled: round > 0.005, bevelSize: Math.min(round, 0.03), bevelThickness: Math.min(round, 0.03), bevelSegments: 1 });
      g.rotateX(Math.PI / 2); g.translate(0, sh.h ?? 0.2, 0); return g;
    }
    case 'sweep': {
      const pts = (sh.path ?? [[0, 0, 0], [1, 0, 0]]).map(([x, y, z]) => new THREE.Vector3(x, y, z));
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(4, pts.length * 4), sh.r ?? 0.05, Math.max(5, Math.min(seg, 8)), false);
    }
  }
}

/** Transform a primitive by scale, rotation (YXZ: yaw, pitch, roll) and position; returns non-indexed geometry with vertex colours. */
function placed(sh: KitShape, round: number, color: THREE.Color, offset?: THREE.Vector3): THREE.BufferGeometry {
  const g0 = primitive(sh, round); const g = g0.index ? g0.toNonIndexed() : g0; if (g !== g0) g0.dispose();
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(sh.at[0], sh.at[1], sh.at[2]).sub(offset ?? new THREE.Vector3()),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(sh.pitch ?? 0, sh.yaw ?? 0, sh.roll ?? 0, 'YXZ')),
    new THREE.Vector3(...(sh.scale ?? [1, 1, 1])),
  );
  g.applyMatrix4(m);
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count, cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { cols[i * 3] = color.r; cols[i * 3 + 1] = color.g; cols[i * 3 + 2] = color.b; }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
  return g;
}
function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let count = 0; for (const g of geos) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 3);
  let o = 0;
  for (const g of geos) { pos.set(g.attributes.position.array as Float32Array, o * 3); nor.set(g.attributes.normal.array as Float32Array, o * 3); col.set(g.attributes.color.array as Float32Array, o * 3); o += g.attributes.position.count; g.dispose(); }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere(); out.computeBoundingBox();
  return out;
}
/** Material class of a shape: shapes of one class merge into one draw. */
const classOf = (sh: KitShape) => (sh.material === 'glass' ? 'glass' : sh.material === 'water' ? 'water' : sh.glow ? 'glow' : 'solid');

export function buildKit(args: KitArgs, ctx: Pick<MeshCtx, 'materials' | 'tint'>): THREE.Group {
  const root = new THREE.Group();
  const byClass = new Map<string, THREE.BufferGeometry[]>();
  const byRole = new Map<string, KitShape[]>();
  const color = new THREE.Color();
  for (const sh of args.shapes) {
    if (sh.role) { const list = byRole.get(sh.role) ?? []; list.push(sh); byRole.set(sh.role, list); continue; }
    color.set(ctx.tint(sh.tint, sh.color ?? ctx.materials.colorOf(sh.material)));
    const k = classOf(sh); const list = byClass.get(k) ?? []; list.push(placed(sh, args.round, color)); byClass.set(k, list);
  }
  const matFor = (k: string) => k === 'glass' ? ctx.materials.get('glass', undefined, { vertexColors: true }) : k === 'water' ? ctx.materials.get('water', undefined, { vertexColors: true }) : k === 'glow' ? ctx.materials.get('emissive', undefined, { vertexColors: true, glow: 0.8 }) : ctx.materials.get('paint', undefined, { vertexColors: true });
  for (const [k, geos] of byClass) { const mesh = new THREE.Mesh(merge(geos), matFor(k)); mesh.castShadow = k === 'solid'; mesh.receiveShadow = true; mesh.name = `kit:${k}`; root.add(mesh); }
  for (const [role, shapes] of byRole) {
    // pivot: explicit on any shape, else the top centre of the role's parts (legs swing from the hip)
    const explicit = shapes.find((s) => s.pivot)?.pivot;
    const pv = explicit ? new THREE.Vector3(...explicit) : (() => { const b = new THREE.Box3(); for (const s of shapes) b.expandByPoint(new THREE.Vector3(...s.at)); const c = b.getCenter(new THREE.Vector3()); return new THREE.Vector3(c.x, b.max.y + (role.startsWith('leg') || role.startsWith('arm') ? (shapes[0].h ?? shapes[0].size?.[1] ?? 0.2) / 2 : 0), c.z); })();
    const geos = shapes.map((sh) => { color.set(ctx.tint(sh.tint, sh.color ?? ctx.materials.colorOf(sh.material))); return placed(sh, args.round, color, pv); });
    const pivot = new THREE.Group(); pivot.name = `role:${role}`; pivot.position.copy(pv); pivot.userData.role = role; pivot.userData.rest = pivot.quaternion.clone();
    const mesh = new THREE.Mesh(merge(geos), shapes.some((s) => s.glow) ? ctx.materials.get('emissive', undefined, { vertexColors: true, glow: 0.8 }) : ctx.materials.get('paint', undefined, { vertexColors: true }));
    mesh.castShadow = true; pivot.add(mesh); root.add(pivot);
  }
  root.userData.gait = args.gait;
  return root;
}

registerMesh({
  gen: 'kit/2',
  build(ctx) {
    const parsed = kitArgs.safeParse(ctx.args); if (!parsed.success) return null;
    const key = ctx.def.hash + ':' + JSON.stringify(Object.fromEntries(Object.entries(ctx.params).filter(([, v]) => typeof v === 'string' && /^#/.test(v))));
    let proto = cache.get(key);
    if (!proto) { proto = buildKit(parsed.data, ctx); cache.set(key, proto); }
    // clone shares geometry and materials; pivots are cloned so each instance animates on its own
    const obj = proto.clone(true); obj.userData = { ...proto.userData };
    return obj;
  },
  instanceKey(ctx) { return ctx.def.hash + ':' + JSON.stringify(Object.fromEntries(Object.entries(ctx.params).filter(([, v]) => typeof v === 'string' && /^#/.test(v)))); },
});
