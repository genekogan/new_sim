import * as THREE from 'three';

type Vertex = {p: number[]; n: number[]; weights: Map<number, number>; info: number[]};
/** Existing kit skin, clipped in bind space. A Feet part can own calf skin, so mixing it
 * with another outfit's cropped Legs can leave actual missing geometry. Only fill that
 * requested interval; no donor clothing triangles are included. */
export function legSkinBand(g: THREE.BufferGeometry, low: number, high: number): THREE.BufferGeometry {
  const P = g.getAttribute('position'), N = g.getAttribute('normal'), J = g.getAttribute('skinIndex'), W = g.getAttribute('skinWeight'), H = g.getAttribute('hinfo'), I = g.index!;
  const vertex = (i: number): Vertex => ({p: [P.getX(i), P.getY(i), P.getZ(i)], n: [N.getX(i), N.getY(i), N.getZ(i)],
    weights: new Map(Array.from({length: 4}, (_, c) => [J.getComponent(i, c), W.getComponent(i, c)] as [number, number]).filter(([, w]) => w > 0)),
    info: [H.getX(i), H.getY(i), H.getZ(i), H.getW(i)]});
  const between = (a: Vertex, b: Vertex, y: number): Vertex => {
    const t = (y - a.p[1]) / (b.p[1] - a.p[1]), weights = new Map<number, number>();
    for (const [j, w] of a.weights) weights.set(j, w * (1 - t));
    for (const [j, w] of b.weights) weights.set(j, (weights.get(j) ?? 0) + w * t);
    return {p: a.p.map((v, c) => c === 1 ? y : v + (b.p[c] - v) * t), n: a.n.map((v, c) => v + (b.n[c] - v) * t), weights, info: t < .5 ? a.info : b.info};
  };
  const clip = (poly: Vertex[], y: number, above: boolean) => {
    const out: Vertex[] = [], inside = (v: Vertex) => above ? v.p[1] >= y : v.p[1] <= y;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], ai = inside(a), bi = inside(b);
      if (ai) out.push(a);
      if (ai !== bi) out.push(between(a, b, y));
    }
    return out;
  };
  const vertices: Vertex[] = [];
  for (let i = 0; i < I.count; i += 3) {
    const ids = [I.getX(i), I.getX(i + 1), I.getX(i + 2)];
    if (!ids.every(j => H.getX(j) < 2)) continue; // skin/skinShade, never donor clothes
    const poly = clip(clip(ids.map(vertex), low, true), high, false);
    for (let k = 1; k + 1 < poly.length; k++) vertices.push(poly[0], poly[k], poly[k + 1]);
  }
  const n = vertices.length, p = new Float32Array(n * 3), normals = new Int8Array(n * 3), joints = new Uint8Array(n * 4), weights = new Uint8Array(n * 4), info = new Uint8Array(n * 4);
  vertices.forEach((v, i) => {
    p.set(v.p, i * 3);
    const len = Math.hypot(...v.n) || 1; normals.set(v.n.map(x => Math.round(x / len * 127)), i * 3);
    const ws = [...v.weights].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = ws.reduce((s, [, w]) => s + w, 0);
    const quant = ws.map(([, w]) => Math.round(w / sum * 255));
    quant[0] += 255 - quant.reduce((s, w) => s + w, 0);
    ws.forEach(([j], c) => { joints[i * 4 + c] = j; weights[i * 4 + c] = quant[c]; });
    info.set(v.info, i * 4);
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(p, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normals, 3, true));
  out.setAttribute('skinIndex', new THREE.BufferAttribute(joints, 4));
  out.setAttribute('skinWeight', new THREE.BufferAttribute(weights, 4, true));
  out.setAttribute('hinfo', new THREE.BufferAttribute(info, 4));
  out.setIndex(Array.from({length: n}, (_, i) => i));
  return out;
}

/** Preserve the selected shoe itself; the repaired look supplies continuous skin instead
 * of grafting two differently sized calf surfaces together at a visible horizontal cut. */
export function withoutSkin(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const info = g.getAttribute('hinfo'), keep: number[] = [], I = g.index!;
  for (let i = 0; i < I.count; i += 3) {
    const ids = [I.getX(i), I.getX(i + 1), I.getX(i + 2)];
    if (!ids.every(j => info.getX(j) < 2)) keep.push(...ids);
  }
  const out = g.clone(); out.setIndex(keep); return out;
}
