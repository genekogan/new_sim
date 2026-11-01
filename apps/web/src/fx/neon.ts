// Soul Actions entry 33: a neon sign's glass tubes (gen-mesh/kits/neon.mesh.ts draws the board and posts).
// Each letter and the border is one tube. Off: pale glass that still reads as letters (lit by the scene). Switched on
// by hand, each tube strikes on its own: a short stutter (a tube catching, dark gaps between flashes; one tube per sign
// is slow and stutters longer), a slight over-bright settle, then a steady glow with a faint shimmer. Lit, a tube is a
// hot pale core inside its colour, a glow on the board behind it (the spill) and a soft bloom around the sign. All the
// tubes of a sign are one draw (per-vertex tube index, one level per tube), plus the glass and the bloom; textures are
// cached by text and colours. A sign seen from far draws only its bloom. Levels are a pure function of (seed, tube,
// seconds since the switch-on): no randomness, no per-frame allocation.
import * as THREE from 'three';
import { registerFx } from './debug.ts';

export const NEON_MAX_CHARS = 32;
/** The words a sign shows: control characters removed, at most 2 lines, 32 characters in all. */
export function neonLines(text: unknown): string[] {
  const s = typeof text === 'string' ? text.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, '') : '';
  const out: string[] = []; let left = NEON_MAX_CHARS;
  for (const line of s.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2)) { if (left <= 0) break; out.push(line.slice(0, left)); left -= line.length; }
  return out;
}

const h1 = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const vn = (x: number) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return h1(i) * (1 - u) + h1(i + 1) * u; };
/** Brightness (0 … ~1.14) of tube `tube` of `count` on the sign seeded `seed`, `t` seconds after it was switched on. */
export function neonLevel(seed: number, tube: number, count: number, t: number): number {
  if (!(t >= 0)) return 0;
  const r = (k: number) => h1((seed % 9973) * 0.0137 + tube * 7.31 + k * 3.17);
  const late = tube === seed % Math.max(1, count);
  const start = 0.05 + r(1) * 0.22 + (late ? 0.3 : 0), end = start + 0.22 + r(2) * 0.45 + (late ? 0.85 : 0);
  if (t < start) return 0;
  if (t < end) {
    // the tube flashes on and off irregularly (about 25 flickers a second), the lit share rising as it catches
    const u = (t - start) / (end - start), duty = 0.3 + 0.62 * u;
    return vn(t * 26 + r(3) * 91) < duty ? 0.55 + 0.45 * u : 0.03;
  }
  return (1 + 0.14 * Math.exp(-(t - end) * 7)) * (0.985 - 0.025 * vn(t * 7.3 + r(4) * 40));
}

export function seedOfNeon(id: string): number { let h = 0x811c9dc5; for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193); return h >>> 0; }

// ---------------------------------------------------------------- tube artwork (canvas, cached)
const PX = 420;                         // canvas pixels per metre of sign
const FONT = "'Avenir Next', 'Helvetica Neue', 'Segoe UI', Arial, sans-serif";
type Glyph = { x: number; y: number; w: number; h: number; u0: number; v0: number; u1: number; v1: number };
type Art = { atlas: THREE.CanvasTexture; glass: THREE.CanvasTexture; bloom: THREE.CanvasTexture; tubes: Glyph[] };
const arts = new Map<string, Art>();
const hex = (c: string): [number, number, number] => { const n = parseInt(c.replace('#', '').padEnd(6, '0').slice(0, 6), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const css = (c: [number, number, number], a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
const roundRect = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
const canvasTex = (c: HTMLCanvasElement, srgb: boolean) => { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true; return t; };

/** Lines laid out in the face (metres from its centre, +y up): the font size, each glyph's box, the border rectangle. */
function layout(g: CanvasRenderingContext2D, lines: string[], w: number, h: number) {
  const inset = 0.05, bw = w - 2 * inset, bh = h - 2 * inset, n = Math.max(1, lines.length);
  let size = Math.min(bh * 0.62 / n, 0.3) * PX; const font = (s: number) => `200 ${s}px ${FONT}`;
  g.font = font(size); while (size > 12 && Math.max(...lines.map((l) => g.measureText(l).width), 1) > (bw - 0.12) * PX) { size -= 2; g.font = font(size); }
  const lineH = size * 1.12, glyphs: { ch: string; x: number; y: number; w: number }[] = [];
  lines.forEach((line, li) => {
    const total = g.measureText(line).width, y = ((n - 1) / 2 - li) * lineH / PX;
    for (let i = 0; i < line.length; i++) { if (line[i] === ' ') continue; const x0 = g.measureText(line.slice(0, i)).width, cw = g.measureText(line[i]).width; glyphs.push({ ch: line[i], x: (x0 + cw / 2 - total / 2) / PX, y, w: cw / PX }); }
  });
  return { size, font: font(size), lineH: lineH / PX, glyphs, border: { w: bw, h: bh } };
}

/** The atlas: the border in the first cell, one cell per letter. Red: the hot core; green: the tube's glow on the board;
 *  blue: a wider soft glow. The glass (lit by the scene, sRGB with alpha) and the bloom are whole-sign pictures. */
function artFor(lines: string[], w: number, h: number, tube: string, border: string): Art {
  const key = JSON.stringify([lines, w, h, tube, border]); const hit = arts.get(key); if (hit) return hit;
  const probe = document.createElement('canvas').getContext('2d')!, L = layout(probe, lines, w, h);
  // the blurs stay inside their cells (a Gaussian of σ reaches about 3σ), so no glow ends in a hard edge
  const tubePx = Math.max(3, L.size * 0.075), glowPx = Math.max(2, Math.round(L.size * 0.075)), wide = Math.max(4, Math.round(L.size * 0.15)), pad = wide * 3;
  // cells: border first (the whole face), then letters packed in rows
  const bwPx = Math.round(L.border.w * PX), bhPx = Math.round(L.border.h * PX), cellH = Math.round(L.lineH * PX + 2 * pad);
  const W = Math.min(2048, THREE.MathUtils.ceilPowerOfTwo(bwPx + 2 * pad)); const cells: { x: number; y: number; w: number; h: number }[] = [{ x: 0, y: 0, w: bwPx + 2 * pad, h: bhPx + 2 * pad }];
  let cx = 0, cy = bhPx + 2 * pad;
  for (const gl of L.glyphs) { const cw = Math.round(gl.w * PX + 2 * pad); if (cx + cw > W) { cx = 0; cy += cellH; } cells.push({ x: cx, y: cy, w: cw, h: cellH }); cx += cw; }
  const H = THREE.MathUtils.ceilPowerOfTwo(cy + (L.glyphs.length ? cellH : 0));
  const atlas = document.createElement('canvas'); atlas.width = W; atlas.height = H; const a = atlas.getContext('2d')!;
  a.fillStyle = '#000'; a.fillRect(0, 0, W, H); a.globalCompositeOperation = 'lighter'; a.lineJoin = a.lineCap = 'round';
  const drawTube = (ctx: CanvasRenderingContext2D, i: number, x: number, y: number, style: string, width: number) => {
    ctx.strokeStyle = ctx.fillStyle = style; ctx.lineWidth = width;
    if (i === 0) { roundRect(ctx, x - bwPx / 2, y - bhPx / 2, bwPx, bhPx, L.size * 0.16); ctx.stroke(); return; }
    ctx.font = L.font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; const ch = L.glyphs[i - 1].ch; ctx.fillText(ch, x, y); if (width > 0) ctx.strokeText(ch, x, y);
  };
  cells.forEach((c, i) => {
    const x = c.x + c.w / 2, y = c.y + c.h / 2;
    a.save(); a.beginPath(); a.rect(c.x, c.y, c.w, c.h); a.clip();
    a.filter = `blur(${wide}px)`; drawTube(a, i, x, y, '#0000ff', tubePx * 1.6);
    a.filter = `blur(${glowPx}px)`; drawTube(a, i, x, y, '#00ff00', tubePx * 1.3);
    a.filter = `blur(${Math.max(1, tubePx * 0.18)}px)`; drawTube(a, i, x, y, '#ff0000', i === 0 ? tubePx * 0.55 : 0);
    a.restore();
  });
  // glass: the same tubes at the same places, pale and shaded (darker rim, lighter centre), alpha only where glass is
  const glass = document.createElement('canvas'); glass.width = Math.round(w * PX); glass.height = Math.round(h * PX); const gg = glass.getContext('2d')!; gg.lineJoin = gg.lineCap = 'round';
  const at = (gx: number, gy: number): [number, number] => [glass.width / 2 + gx * PX, glass.height / 2 - gy * PX];
  const tubeAt = (ctx: CanvasRenderingContext2D, i: number, style: string, width: number, p: [number, number]) => drawTube(ctx, i, p[0], p[1], style, width);
  const dim = (c: [number, number, number], k: number): [number, number, number] => [c[0] * k, c[1] * k, c[2] * k];
  const tc = hex(tube), bc = hex(border), pale = (c: [number, number, number], k: number): [number, number, number] => [c[0] * (1 - k) + 0.86 * k, c[1] * (1 - k) + 0.86 * k, c[2] * (1 - k) + 0.88 * k];
  for (let i = 0; i <= L.glyphs.length; i++) {
    const p = i === 0 ? at(0, 0) : at(L.glyphs[i - 1].x, L.glyphs[i - 1].y), c = i === 0 ? bc : tc;
    tubeAt(gg, i, css(dim(pale(c, 0.55), 0.55), 0.9), tubePx * 1.15, p);
    tubeAt(gg, i, css(dim(pale(c, 0.8), 0.8), 0.95), i === 0 ? tubePx * 0.4 : 0, p);
  }
  // bloom: every tube in its colour, heavily blurred, on a canvas half again the face's size
  const bloom = document.createElement('canvas'); bloom.width = 256; bloom.height = Math.max(64, Math.round(256 * h / w)); const bl = bloom.getContext('2d')!; bl.fillStyle = '#000'; bl.fillRect(0, 0, bloom.width, bloom.height); bl.globalCompositeOperation = 'lighter';   // opaque: the shader adds rgb, so no un-premultiplied colour in the clear parts
  const k = bloom.width / (w * 1.5 * PX); bl.setTransform(k, 0, 0, k, bloom.width / 2 - glass.width / 2 * k, bloom.height / 2 - glass.height / 2 * k); bl.filter = `blur(${Math.max(6, Math.round(bloom.width * 0.05))}px)`; bl.lineJoin = bl.lineCap = 'round';
  for (let i = 0; i <= L.glyphs.length; i++) tubeAt(bl, i, css(i === 0 ? bc : tc, 0.8), tubePx * 2.2, i === 0 ? at(0, 0) : at(L.glyphs[i - 1].x, L.glyphs[i - 1].y));
  const tubes: Glyph[] = cells.map((c, i) => ({ x: i === 0 ? 0 : L.glyphs[i - 1].x, y: i === 0 ? 0 : L.glyphs[i - 1].y, w: c.w / PX, h: c.h / PX, u0: c.x / W, v0: 1 - (c.y + c.h) / H, u1: (c.x + c.w) / W, v1: 1 - c.y / H }));
  const art = { atlas: canvasTex(atlas, false), glass: canvasTex(glass, true), bloom: canvasTex(bloom, false), tubes };
  arts.set(key, art); if (arts.size > 24) { const [k0, old] = arts.entries().next().value as [string, Art]; arts.delete(k0); for (const t of [old.atlas, old.glass, old.bloom]) t.dispose(); }
  return art;
}

// ---------------------------------------------------------------- materials
const MAX_TUBES = NEON_MAX_CHARS + 1;
const LIT_VS = /* glsl */ `attribute float tube; uniform float uLevel[${MAX_TUBES}]; varying vec2 vUv; varying float vL, vB;
void main(){ vUv = uv; int i = int(tube + 0.5); vL = uLevel[i]; vB = i == 0 ? 1.0 : 0.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const LIT_FS = /* glsl */ `uniform sampler2D uMap; uniform vec3 uTube, uBorder; uniform float uNight; varying vec2 vUv; varying float vL, vB;
void main(){ vec3 t = texture2D(uMap, vUv).rgb, c = mix(uTube, uBorder, vB);
  vec3 core = mix(c, vec3(1.0), 0.5) * t.r * 1.5;                    // the hot core, paler than the glass colour
  vec3 glow = c * (t.g * (0.5 + 0.3 * uNight) + t.b * (0.1 + 0.28 * uNight));   // spill on the board, stronger at night
  gl_FragColor = vec4((core + glow) * vL, 1.0); }`;
const BLOOM_FS = /* glsl */ `uniform sampler2D uMap; uniform float uLevel, uNight; varying vec2 vUv;
void main(){ gl_FragColor = vec4(texture2D(uMap, vUv).rgb * uLevel * (0.07 + 0.34 * uNight), 1.0); }`;
const cam = new THREE.Vector3(1e9, 1e9, 1e9);
function noteCamera(_r: THREE.WebGLRenderer, _s: THREE.Scene, camera: THREE.Camera) { if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) cam.setFromMatrixPosition(camera.matrixWorld); }
const reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
/** Beyond this distance (m) a lit sign draws only its bloom (one draw), not its glass and tubes. */
const NEAR = 60;

type Live = { id: string; lit: boolean; warm: boolean; t0: number; seed: number; count: number; levels: Float32Array; group: THREE.Group };
const live = new Set<Live>();
const neonStats = { mounted: 0, enabled: true };
registerFx('neon', {
  set(on) { neonStats.enabled = on; for (const s of live) s.group.visible = on; },
  /** For proofs: each lit sign near the camera, its tube levels now and the seconds since its switch-on. */
  stats() { const now = Date.now() / 1000; return { ...neonStats, signs: [...live].filter((s) => s.lit).map((s) => ({ id: s.id, warm: s.warm, since: s.warm ? +(now - s.t0).toFixed(3) : null, levels: [...s.levels].slice(0, s.count).map((v) => +v.toFixed(3)), d: +s.group.getWorldPosition(new THREE.Vector3()).distanceTo(cam).toFixed(1) })) }; },
});

export type NeonFace = { at: readonly number[]; w: number; h: number };
/** Put the tubes on `root` at `face` (the def frame). `warm`: switched on by hand just now (strike and stutter);
 *  otherwise a lit sign is steady at once. Ticks through `root.userData.fx` (motion.ts). */
export function mountNeon(root: THREE.Object3D, o: { id: string; text: unknown; tube: string; border: string; face: NeonFace; lit: boolean; warm: boolean; night: () => number }): void {
  const lines = neonLines(o.text), art = artFor(lines, o.face.w, o.face.h, o.tube, o.border), count = art.tubes.length;
  const group = new THREE.Group(); group.name = 'neon tubes'; group.position.set(o.face.at[0], o.face.at[1], o.face.at[2]);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(o.face.w, o.face.h), new THREE.MeshStandardMaterial({ map: art.glass, transparent: true, alphaTest: 0.25, roughness: 0.22, metalness: 0.05, depthWrite: false }));
  glass.name = 'neon glass'; glass.renderOrder = 1; glass.onBeforeRender = noteCamera; group.add(glass);
  const s: Live = { id: o.id, lit: o.lit, warm: o.warm, t0: Date.now() / 1000, seed: seedOfNeon(o.id), count, levels: new Float32Array(MAX_TUBES), group };
  const geos: THREE.BufferGeometry[] = [glass.geometry], mats: THREE.Material[] = [glass.material];
  let tubes: THREE.Mesh | null = null, bloom: THREE.Mesh | null = null;
  const lu = { uLevel: { value: s.levels }, uNight: { value: 0 } }, bu = { uLevel: { value: 0 }, uNight: lu.uNight, uMap: { value: art.bloom } };
  if (o.lit) {
    // one quad per tube cell, each reading its own level
    const pos: number[] = [], uv: number[] = [], tube: number[] = [], index: number[] = [];
    art.tubes.forEach((c, i) => {
      const b = pos.length / 3, x0 = c.x - c.w / 2, x1 = c.x + c.w / 2, y0 = c.y - c.h / 2, y1 = c.y + c.h / 2;
      pos.push(x0, y0, 0.003, x1, y0, 0.003, x1, y1, 0.003, x0, y1, 0.003); uv.push(c.u0, c.v0, c.u1, c.v0, c.u1, c.v1, c.u0, c.v1); tube.push(i, i, i, i); index.push(b, b + 1, b + 2, b, b + 2, b + 3);
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('tube', new THREE.Float32BufferAttribute(tube, 1)); g.setIndex(index);
    const [tr, tg, tb] = hex(o.tube), [br, bg, bb] = hex(o.border);
    const m = new THREE.ShaderMaterial({ uniforms: { ...lu, uMap: { value: art.atlas }, uTube: { value: new THREE.Vector3(tr, tg, tb) }, uBorder: { value: new THREE.Vector3(br, bg, bb) } }, vertexShader: LIT_VS, fragmentShader: LIT_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    tubes = new THREE.Mesh(g, m); tubes.name = 'neon light'; tubes.renderOrder = 2; tubes.onBeforeRender = noteCamera; group.add(tubes); geos.push(g); mats.push(m);
    const bg2 = new THREE.PlaneGeometry(o.face.w * 1.5, o.face.h * 1.5), bm = new THREE.ShaderMaterial({ uniforms: bu, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: BLOOM_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    bloom = new THREE.Mesh(bg2, bm); bloom.name = 'neon bloom'; bloom.position.z = 0.006; bloom.renderOrder = 3; bloom.onBeforeRender = noteCamera; group.add(bloom); geos.push(bg2); mats.push(bm);
  }
  root.add(group); live.add(s); neonStats.mounted++;
  const at = new THREE.Vector3();
  const update = (t: number) => {
    const since = s.warm && !reduced?.matches ? t - s.t0 : Infinity; let sum = 0;
    for (let i = 0; i < count; i++) { const v = since === Infinity ? 0.985 - 0.025 * vn(t * 7.3 + i * 3.1) : neonLevel(s.seed, i, count, since); s.levels[i] = v; sum += v; }
    bu.uLevel.value = sum / Math.max(1, count); lu.uNight.value = Math.max(0, Math.min(1, o.night()));
  };
  update(Date.now() / 1000);
  if (o.lit) {
    const prev = root.userData.fx as ((t: number) => void) | undefined;
    root.userData.fx = (t: number) => {
      prev?.(t);
      if (!neonStats.enabled) return;
      group.getWorldPosition(at); const far = at.distanceTo(cam) > NEAR; glass.visible = tubes!.visible = !far;
      update(t);
    };
  }
  root.addEventListener('removed', function gone() { root.removeEventListener('removed', gone); live.delete(s); neonStats.mounted--; for (const g of geos) g.dispose(); for (const m of mats) m.dispose(); });
}
