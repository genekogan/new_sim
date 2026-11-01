// Soul Actions entry 38: one poster's paper, print, bulge, curl and tape, drawn the same on the poster wall (apps/web sign
// mesh) and in a Soul's hands while it goes up or comes down (humans.ts), so the handoff between the two is invisible.
// Local frame: x right along the wall, y up, z out of the wall; the origin is the sheet's centre on the wall's surface.
import * as THREE from 'three';

/** Papers: cream, pale yellow, pale blue, pink, white; each with an accent for its print. Index from posterPaper(). */
export const PAPERS = [
  { paper: '#f4ecd6', ink: '#2b2118', accent: '#b8432f' },
  { paper: '#f6e7a1', ink: '#2a2418', accent: '#2f4f8f' },
  { paper: '#d7e6ef', ink: '#1d2a3a', accent: '#c4552d' },
  { paper: '#f3d3d6', ink: '#2c1b22', accent: '#30614a' },
  { paper: '#f7f6f1', ink: '#1f1f22', accent: '#d08a1a' },
];
const texCache = new Map<string, THREE.CanvasTexture>();
const hash = (t: string) => { let h = 2166136261; for (const ch of t) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; };
/** How a poster has aged: 0 fresh … 1 well out of date (3+ world days: yellowed, faded ink). */
export const posterAgeK = (days: number) => Math.max(0, Math.min(1, days / 3));
function wrap(g: CanvasRenderingContext2D, text: string, width: number) {
  const out: string[] = [];
  for (const para of text.split('\n')) { let cur = ''; for (const w of para.split(/\s+/).filter(Boolean)) { const t = cur ? cur + ' ' + w : w; if (cur && g.measureText(t).width > width) { out.push(cur); cur = w; } else cur = t; } if (cur) out.push(cur); }
  return out;
}
/** The printed face: title large (up to 3 lines), a rule, the detail (up to 3 lines), the author small at the foot. */
export function posterTexture(title: string, detail: string, name: string, paper: number, ageDays = 0): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const age = posterAgeK(ageDays), key = JSON.stringify([title, detail, name, paper, Math.round(age * 6)]);
  const hit = texCache.get(key); if (hit) return hit;
  const P = PAPERS[((paper % PAPERS.length) + PAPERS.length) % PAPERS.length], cw = 600, ch = 800, c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const g = c.getContext('2d')!; let seed = Math.floor(hash(key) * 1e9) | 1; const rnd = () => ((seed = Math.imul(seed ^ (seed >>> 13), 1103515245) + 12345 | 0) >>> 0) / 4294967296;
  g.fillStyle = P.paper; g.fillRect(0, 0, cw, ch);
  // paper grain and a little unevenness of tone
  for (let i = 0; i < 2200; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.08)'; g.fillRect(rnd() * cw, rnd() * ch, 1 + rnd() * 2, 1 + rnd() * 2); }
  const r = hash(title + name), style = Math.floor(r * 3);
  // print: an accent band (style 0), a frame (style 1) or a sun disc (style 2) behind the title
  g.globalAlpha = 1 - age * 0.45;
  if (style === 0) { g.fillStyle = P.accent; g.fillRect(0, 0, cw, 26); g.fillRect(0, ch - 18, cw, 18); }
  else if (style === 1) { g.strokeStyle = P.accent; g.lineWidth = 10; g.strokeRect(22, 22, cw - 44, ch - 44); }
  else { g.fillStyle = P.accent; g.globalAlpha *= 0.22; g.beginPath(); g.arc(cw * 0.78, ch * 0.2, 120, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1 - age * 0.45; }
  // title: the largest bold size (≤ 3 lines) that fits the width
  const tt = (title || 'Poster').toUpperCase(); let size = 118, lines: string[] = [];
  for (; size >= 40; size -= 4) { g.font = `900 ${size}px 'Arial Black', Impact, 'Helvetica Neue', Arial, sans-serif`; lines = wrap(g, tt, cw - 70); if (lines.length <= 3 && lines.every(l => g.measureText(l).width <= cw - 70)) break; }
  g.fillStyle = P.ink; g.textAlign = 'center'; g.textBaseline = 'top';
  let y = style === 1 ? 70 : 62; for (const l of lines.slice(0, 3)) { g.fillText(l, cw / 2, y, cw - 60); y += size * 1.02; }
  y += 18; g.fillStyle = P.accent; g.fillRect(cw * 0.3, y, cw * 0.4, 8); y += 34;
  // detail: up to three lines in a plain face
  if (detail) { let ds = 46, dl: string[] = []; for (; ds >= 26; ds -= 2) { g.font = `600 ${ds}px Georgia, 'Times New Roman', serif`; dl = wrap(g, detail, cw - 80); if (dl.length <= 3 && y + dl.length * ds * 1.2 < ch - 90) break; }
    g.fillStyle = P.ink; for (const l of dl.slice(0, 3)) { g.fillText(l, cw / 2, y, cw - 70); y += ds * 1.22; } }
  if (name) { g.font = `italic 500 28px Georgia, serif`; g.fillStyle = P.ink; g.globalAlpha = 0.75 - age * 0.3; g.textAlign = 'right'; g.fillText('— ' + name, cw - 40, ch - 64); }
  g.globalAlpha = 1;
  // age: yellowing, foxing spots and a faded print
  if (age > 0) {
    g.fillStyle = `rgba(214,178,92,${0.32 * age})`; g.fillRect(0, 0, cw, ch);
    g.fillStyle = `rgba(255,248,225,${0.22 * age})`; g.fillRect(0, 0, cw, ch);
    for (let i = 0; i < 12 * age; i++) { g.fillStyle = `rgba(150,110,50,${0.10 + rnd() * 0.12})`; g.beginPath(); g.arc(rnd() * cw, rnd() * ch, 4 + rnd() * 16, 0, Math.PI * 2); g.fill(); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; texCache.set(key, t); return t;
}
/** Out from the wall at (x, y) of a w×h sheet: a few mm on the surface, a slight bulge between the taped corners, and (aged)
 *  a lifted, curling bottom-right corner. */
export function sheetLift(x: number, y: number, w: number, h: number, ageDays = 0) {
  const u = x / w + 0.5, v = y / h + 0.5, curl = posterAgeK(ageDays) > 0.6 ? 0.035 : 0;
  const d = Math.hypot((1 - u) * w, v * h), k = Math.max(0, 1 - d / 0.16);
  return 0.002 + 0.006 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v) + curl * k * k;
}
/** The sheet's surface from v = `from` (0 = bottom edge) to its top edge, as a bent plane (UVs cropped to match). */
export function sheetGeometry(w: number, h: number, from = 0, ageDays = 0, geo?: THREE.BufferGeometry): THREE.BufferGeometry {
  const nx = 10, ny = 14, n = (nx + 1) * (ny + 1);
  const g = geo ?? new THREE.BufferGeometry();
  let pos = g.getAttribute('position') as THREE.BufferAttribute | undefined, uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!pos) { pos = new THREE.BufferAttribute(new Float32Array(n * 3), 3); uv = new THREE.BufferAttribute(new Float32Array(n * 2), 2); g.setAttribute('position', pos); g.setAttribute('uv', uv);
    const idx: number[] = []; for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; idx.push(a, b, d, a, d, c); } g.setIndex(idx); }
  const f = Math.max(0, Math.min(1, from));
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const k = j * (nx + 1) + i, u = i / nx, v = f + (1 - f) * (j / ny), x = (u - 0.5) * w, y = (v - 0.5) * h;
    pos.setXYZ(k, x, y, sheetLift(x, y, w, h, ageDays)); uv!.setXY(k, u, v);
  }
  pos.needsUpdate = true; uv!.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere(); return g;
}
const tapeMat = () => new THREE.MeshStandardMaterial({ color: '#e9dcb4', roughness: 0.9, metalness: 0, transparent: true, opacity: 0.88, side: THREE.DoubleSide });
/** Masking-tape strips across the corners (top-left, top-right, bottom-left, bottom-right), named tape-0…3. */
export function tapeStrips(w: number, h: number, seedText: string): THREE.Mesh[] {
  const geo = new THREE.PlaneGeometry(0.075, 0.026), mat = tapeMat(), r = hash(seedText);
  return [[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([sx, sy], i) => {
    const m = new THREE.Mesh(geo, mat); m.name = 'tape-' + i;
    const x = sx * (w / 2 - 0.012), y = sy * (h / 2 - 0.012); m.position.set(x, y, sheetLift(x, y, w, h) + 0.0012);
    m.rotation.z = sx * sy * -0.75 + (hash(seedText + i) - 0.5) * 0.25 + (r - 0.5) * 0.1; return m;
  });
}
/** One whole poster as it sits on the wall (sheet + four tapes), local frame as above. */
export function posterMesh(p: { t: string; d: string; n: string; paper: number; age: number }, w: number, h: number): THREE.Group {
  const g = new THREE.Group(), map = posterTexture(p.t, p.d, p.n, p.paper, p.age);
  const sheet = new THREE.Mesh(sheetGeometry(w, h, 0, p.age), new THREE.MeshStandardMaterial({ map: map ?? undefined, color: map ? '#ffffff' : PAPERS[p.paper % PAPERS.length].paper, roughness: 0.92, metalness: 0, side: THREE.DoubleSide }));
  sheet.name = 'poster-sheet'; g.add(sheet); for (const t of tapeStrips(w, h, p.t + p.n)) g.add(t);
  // an out-of-date poster has lost its bottom-right tape (that corner curls)
  if (posterAgeK(p.age) > 0.6) g.getObjectByName('tape-3')!.visible = false;
  return g;
}
/** A rolled sheet: a paper tube along local x, `len` long, radius `r` (a spiral end cap reads as paper). */
export function rollMesh(paper: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 16, 1, false), new THREE.MeshStandardMaterial({ color: PAPERS[paper % PAPERS.length].paper, roughness: 0.9, metalness: 0 }));
  m.name = 'poster-roll'; return m;
}
/** The world day the viewer is showing (set by the live view from the depicted tick; null = unknown, posters look fresh). */
let shownDay: number | null = null;
export function setPosterDay(day: number | null) { const changed = day !== shownDay; shownDay = day; return changed; }
export const posterDay = () => shownDay;
export const posterAgeDays = (day: number) => shownDay === null ? 0 : Math.max(0, shownDay - day);
