// Source-bound actual HumanViews fixture. No services, models or network.
import { readFileSync } from 'node:fs';
import { registerHooks, createRequire } from 'node:module';
import * as THREE from '../../apps/web/node_modules/three/build/three.module.js';
const M = new URL('../../mars/viewer/', import.meta.url).pathname;
const esbuild = createRequire(new URL('../../mars/viewer/package.json', import.meta.url))('esbuild');
registerHooks({
  resolve(spec, ctx, next) { try { return next(spec, ctx); } catch (error) { if (ctx.parentURL?.startsWith('file://' + M) && spec.startsWith('.')) return next(spec + '.ts', ctx); throw error; } },
  load(url, ctx, next) { if (url.startsWith('file://' + M) && url.endsWith('.ts')) return { format: 'module', source: esbuild.transformSync(readFileSync(process.env.ACTIVITY_POSES_SOURCE && url.endsWith('/activity-poses.ts') ? process.env.ACTIVITY_POSES_SOURCE : new URL(url), 'utf8'), { loader: 'ts', format: 'esm' }).code, shortCircuit: true }; return next(url, ctx); },
});
export { THREE };
export async function readingRigFixture() {
  const DIR = process.env.GLB_DIR ?? M + 'public/modular/environment/';
  globalThis.location ??= { href: 'http://local/' };
  globalThis.fetch = async url => { const bytes = readFileSync(DIR + String(url).split('/').pop().split('?')[0]); return new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); };
  const { loadTemplates } = await import(M + 'app/engine-view/people.ts');
  const { HumanViews } = await import(M + 'app/engine-view/humans.ts');
  const { ThreeResources } = await import(M + 'lib/three-resources.ts');
  const resources = new ThreeResources();
  const templates = await loadTemplates(new AbortController().signal, resources);
  const views = new HumanViews(false); views.setTemplates(templates);
  const idFor = name => { for (let k = 0; k < 500; k++) { const id = `read-${k}`; let hash = 0; for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0; if (templates[hash % templates.length].name === name) return id; } };
  return { templates, views, idFor, resources };
}
export function worldVertices(object) {
  const points = []; object.updateWorldMatrix(true, true);
  object.traverse(mesh => { if (!mesh.isMesh) return; const attr = mesh.geometry.attributes.position; for (let i = 0; i < attr.count; i++) { const p = new THREE.Vector3(); mesh.getVertexPosition(i, p); mesh.localToWorld(p); points.push(p); } });
  return points;
}

/** Intersect actual deformed thigh triangles with each physical page/cover box, in that box's local frame. */
export function bookThighContacts(holder) {
  const book = holder.getObjectByName('activity prop: book');
  holder.updateWorldMatrix(true, true);
  const boxes = []; book.traverse(mesh => { if (mesh.isMesh) { mesh.geometry.computeBoundingBox(); boxes.push({ box: mesh.geometry.boundingBox, inverse: mesh.matrixWorld.clone().invert() }); } });
  const triangles = [], a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let thighTop = -Infinity;
  holder.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const pos = mesh.geometry.attributes.position, skin = mesh.geometry.attributes.skinIndex, weight = mesh.geometry.attributes.skinWeight;
    const indices = mesh.geometry.index;
    const legBones = new Set(mesh.skeleton.bones.map((bone, index) => /^(UpperLeg|LowerLeg)[LR]$/.test(bone.name) ? index : -1));
    const isLeg = index => { let total = 0; for (let lane = 0; lane < 4; lane++) if (legBones.has(skin.getComponent(index, lane))) total += weight.getComponent(index, lane); return total > .5; };
    const world = index => { const p = new THREE.Vector3(); mesh.getVertexPosition(index, p); return mesh.localToWorld(p); };
    const count = indices?.count ?? pos.count;
    for (let i = 0; i < count; i += 3) {
      const ids = [0, 1, 2].map(k => indices ? indices.getX(i + k) : i + k);
      if (!ids.some(isLeg)) continue;
      const tri = ids.map(world); triangles.push(tri); for (const p of tri) thighTop = Math.max(thighTop, p.y);
    }
  });
  let intersections = 0;
  for (const { box, inverse } of boxes) for (const tri of triangles) {
    a.copy(tri[0]).applyMatrix4(inverse); b.copy(tri[1]).applyMatrix4(inverse); c.copy(tri[2]).applyMatrix4(inverse);
    if (box.intersectsTriangle(new THREE.Triangle(a, b, c))) intersections++;
  }
  const bounds = new THREE.Box3().setFromPoints(worldVertices(book));
  return { intersections, thighTriangles: triangles.length, thighTop, bookMin: bounds.min.toArray(), bookMax: bounds.max.toArray() };
}
