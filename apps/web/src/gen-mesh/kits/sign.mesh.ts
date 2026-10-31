// Signs, boards, frames and screens (defs tagged `sign-text`): the kit/2 body plus text or media
// faces listed in make.args.faces. Text: entity state `text` (lines split by \n), else the def's
// `sign` component lines; a face with `line: n` shows only line n (signpost arrows). Media faces
// show state `media` (one web link or same-site path per slot: image or looping video) or a small painting. Owner: L4.
import * as THREE from 'three';
import { kitArgs } from '@sim/generators';
import { buildKit } from '../kit.mesh.ts';
import { registerMesh } from '../registry.ts';
import { bindMotionModel } from '../motion.ts';
import { apiPath } from '../../world-path.ts';
import { artOf, brokenLinkLines, coverWhenReady, imageBroken, imageFailed, imageLoaded, videoTexture, whenImageFails } from '../art-media.ts';
import { frameMediaKind, pinSlot, signupSlot, pollSlot, pollOptions } from '@sim/world-compiler';

type Face = { at: [number, number, number]; w: number; h: number; yaw?: number; pitch?: number; bg?: string; ink?: string; font?: string; line?: number; media?: boolean; slot?: number };
const texCache = new Map<string, THREE.Texture>();
const loader = typeof document !== 'undefined' ? new THREE.TextureLoader() : null;

/** What a media line loads: an http(s) URL as is, this world's `/assets/<sha>` under its world path, other same-site
 *  paths (e.g. `/w/<world>/art/<sha>.mp4`) as is; null for anything the shared frame-media rule refuses. */
export function signMediaPath(media: unknown): string | null {
  if (!frameMediaKind(media)) return null;
  const m = media as string;
  return /^\/assets\//.test(m) ? apiPath(m) : m;
}


function textTexture(lines: string[], f: Face): THREE.Texture {
  const key = JSON.stringify([lines, f.w, f.h, f.bg, f.ink, f.font]);
  const hit = texCache.get(key); if (hit) return hit;
  const px = 256, cw = Math.max(64, Math.round(px * Math.min(4, f.w / Math.max(f.h, 0.05)))), ch = px;
  const c = document.createElement('canvas'); c.width = cw; c.height = ch; const g = c.getContext('2d')!;
  g.fillStyle = f.bg ?? '#efe2c0'; g.fillRect(0, 0, cw, ch);
  const ls = lines.length ? lines : [''];
  let size = Math.floor((ch * 0.8) / ls.length);
  const font = (s: number) => `${f.font ?? '600'} ${s}px Georgia, 'Iowan Old Style', serif`;
  g.font = font(size); while (size > 10 && Math.max(...ls.map((l) => g.measureText(l).width)) > cw * 0.9) { size -= 2; g.font = font(size); }
  g.fillStyle = f.ink ?? '#3a2a22'; g.textAlign = 'center'; g.textBaseline = 'middle';
  ls.forEach((l, i) => g.fillText(l, cw / 2, ch / 2 + (i - (ls.length - 1) / 2) * size * 1.1));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; texCache.set(key, t); return t;
}
/** Soul Actions entry 19: a pinboard's notes (one per line, "words — Name") as signed paper cards pinned to cork, each in
 *  its slot (pinSlot, the place the hand went). Seeded by the words, so every viewer sees the same tilt and paper. */
export function pinboardTexture(lines: string[], f: Face): THREE.Texture {
  const key = JSON.stringify(['pinboard', lines, f.w, f.h, f.bg]);
  const hit = texCache.get(key); if (hit) return hit;
  const cw = 1024, ch = Math.round(cw * f.h / f.w), px = cw / f.w, c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const g = c.getContext('2d')!; let seed = 7; const rnd = () => ((seed = Math.imul(seed ^ (seed >>> 13), 1103515245) + 12345 | 0) >>> 0) / 4294967296;
  g.fillStyle = f.bg ?? '#b88a5a'; g.fillRect(0, 0, cw, ch);
  for (let i = 0; i < 2600; i++) { g.fillStyle = rnd() < 0.5 ? 'rgba(70,40,15,0.22)' : 'rgba(235,200,150,0.18)'; g.fillRect(rnd() * cw, rnd() * ch, 2 + rnd() * 3, 2 + rnd() * 3); }
  const hash = (t: string) => { let h = 2166136261; for (const ch of t) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; };
  const papers = ['#fbf6e4', '#fdf0a6', '#d9ecf7', '#f8dbe0', '#e3f2d6'];
  lines.slice(0, 6).forEach((line, i) => {
    if (!line.trim()) return;
    const cut = line.lastIndexOf(' — '), words = cut >= 0 ? line.slice(0, cut) : line, who = cut >= 0 ? line.slice(cut + 3) : '', r = hash(line);
    const [sx, sy] = pinSlot(i), x = (sx / f.w + 0.5) * cw, y = (0.5 - sy / f.h) * ch, w = 0.33 * px, h = 0.31 * px;
    g.save(); g.translate(x, y); g.rotate((r - 0.5) * 0.12);
    g.fillStyle = 'rgba(30,15,5,0.35)'; g.fillRect(-w / 2 + 6, -h / 2 + 8, w, h);
    g.fillStyle = papers[Math.floor(r * papers.length)]; g.fillRect(-w / 2, -h / 2, w, h);
    // the words, wrapped to the card at the largest size that fits four lines; the author's name signs the bottom
    g.fillStyle = '#26221e'; g.textAlign = 'left'; g.textBaseline = 'top';
    let size = 34, wrapped: string[] = [];
    for (; size >= 16; size -= 2) {
      g.font = `500 ${size}px 'Comic Sans MS', 'Segoe Print', 'Bradley Hand', cursive`; wrapped = [];
      for (const word of words.split(/\s+/)) { const last = wrapped.at(-1); if (last !== undefined && g.measureText(last + ' ' + word).width <= w - 28) wrapped[wrapped.length - 1] = last + ' ' + word; else wrapped.push(word); }
      if (wrapped.length * size * 1.15 <= h - 70 && wrapped.every(l => g.measureText(l).width <= w - 28)) break;
    }
    wrapped.slice(0, 5).forEach((l, k) => g.fillText(l, -w / 2 + 14, -h / 2 + 26 + k * size * 1.15));
    if (who) { g.font = `italic 600 24px Georgia, serif`; g.fillStyle = '#5a3d22'; g.textAlign = 'right'; g.fillText('— ' + who, w / 2 - 14, h / 2 - 36); }
    g.fillStyle = ['#c62f2a', '#2a62c6', '#2f9a4a'][Math.floor(r * 3)]; g.beginPath(); g.arc(0, -h / 2 + 12, 10, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.arc(-3, -h / 2 + 9, 3, 0, Math.PI * 2); g.fill();
    g.restore();
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; texCache.set(key, t); return t;
}
/** Soul Actions entry 25: chalk on slate (a dusty board, hand lettering left-aligned), a sign-up sheet (printed title, ruled
 *  numbered lines, each name in its signer's hand at signupSlot), a poll (question, options, tally marks at pollSlot). */
const HAND = "'Bradley Hand', 'Segoe Print', 'Comic Sans MS', cursive", CHALK = "'Chalkboard SE', 'Chalkboard', 'Marker Felt', 'Comic Sans MS', cursive";
const hashOf = (t: string) => { let h = 2166136261; for (const ch of t) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; };
function canvasOf(f: Face, w = 1024) { const c = document.createElement('canvas'); c.width = w; c.height = Math.round(w * f.h / f.w); return { c, g: c.getContext('2d')!, cw: c.width, ch: c.height, px: c.width / f.w }; }
function done(c: HTMLCanvasElement, key: string) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; texCache.set(key, t); return t; }
export function chalkTexture(lines: string[], f: Face): THREE.Texture {
  const key = JSON.stringify(['chalk', lines, f.w, f.h, f.bg]); const hit = texCache.get(key); if (hit) return hit;
  const { c, g, cw, ch } = canvasOf(f, 768); let seed = 11; const rnd = () => ((seed = Math.imul(seed ^ (seed >>> 13), 1103515245) + 12345 | 0) >>> 0) / 4294967296;
  g.fillStyle = f.bg ?? '#2b322e'; g.fillRect(0, 0, cw, ch);
  for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(230,230,220,${0.02 + rnd() * 0.04})`; g.beginPath(); g.ellipse(rnd() * cw, rnd() * ch, 30 + rnd() * 90, 10 + rnd() * 30, rnd() * 3, 0, Math.PI * 2); g.fill(); }
  const ls = lines.filter((l) => l.trim()).slice(0, 6); let size = 74; g.font = `600 ${size}px ${CHALK}`;
  while (size > 22 && (ls.some((l) => g.measureText(l).width > cw * 0.86) || ls.length * size * 1.25 > ch * 0.85)) { size -= 2; g.font = `600 ${size}px ${CHALK}`; }
  g.fillStyle = f.ink ?? '#f4f2e8'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.shadowColor = 'rgba(255,255,255,0.35)'; g.shadowBlur = 3;
  ls.forEach((l, i) => g.fillText(l, cw * 0.07, ch / 2 + (i - (ls.length - 1) / 2) * size * 1.25));
  return done(c, key);
}
export function signupTexture(title: string, names: string[], f: Face): THREE.Texture {
  const key = JSON.stringify(['signup', title, names, f.w, f.h]); const hit = texCache.get(key); if (hit) return hit;
  const { c, g, cw, ch, px } = canvasOf(f, 768);
  g.fillStyle = f.bg ?? '#fbfaf4'; g.fillRect(0, 0, cw, ch);
  g.fillStyle = '#22303e'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 ${Math.round(0.034 * px)}px Georgia, serif`; g.fillText(title || 'Sign up', cw / 2, ch * 0.09, cw * 0.9);
  for (let i = 0; i < 8; i++) {
    const [, sy] = signupSlot(i), y = (0.5 - sy / f.h) * ch;
    g.strokeStyle = 'rgba(70,110,160,0.45)'; g.lineWidth = 2; g.beginPath(); g.moveTo(cw * 0.1, y + 0.014 * px); g.lineTo(cw * 0.92, y + 0.014 * px); g.stroke();
    g.fillStyle = '#7a8796'; g.textAlign = 'right'; g.font = `500 ${Math.round(0.022 * px)}px Georgia, serif`; g.fillText(`${i + 1}.`, cw * 0.17, y);
    const name = names[i]; if (!name) continue;
    const r = hashOf(name); g.save(); g.translate(cw * 0.21, y); g.rotate((r - 0.5) * 0.06);
    g.fillStyle = ['#1d2f6e', '#2a2622', '#6b1d1d'][Math.floor(r * 3)]; g.textAlign = 'left'; g.font = `600 ${Math.round(0.032 * px)}px ${HAND}`; g.fillText(name, 0, 0, cw * 0.68); g.restore();
  }
  return done(c, key);
}
export function pollTexture(title: string, options: string[], counts: number[], f: Face): THREE.Texture {
  const key = JSON.stringify(['poll', title, options, counts, f.w, f.h]); const hit = texCache.get(key); if (hit) return hit;
  const { c, g, cw, ch, px } = canvasOf(f, 1024);
  g.fillStyle = f.bg ?? '#f3efe2'; g.fillRect(0, 0, cw, ch);
  g.fillStyle = '#2a2622'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 ${Math.round(0.06 * px)}px Georgia, serif`; g.fillText(title || 'Poll', cw / 2, ch * 0.12, cw * 0.92);
  options.forEach((o, i) => {
    const [tx, ty] = pollSlot(i), y = (0.5 - ty / f.h) * ch, x0 = (tx / f.w + 0.5) * cw - 0.06 * px;
    g.fillStyle = '#2a2622'; g.textAlign = 'right'; g.font = `600 ${Math.round(0.05 * px)}px Georgia, serif`; g.fillText(o, x0 - 0.04 * px, y, cw * 0.5);
    g.strokeStyle = 'rgba(40,40,40,0.25)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x0 - 0.02 * px, y + 0.04 * px); g.lineTo(cw * 0.95, y + 0.04 * px); g.stroke();
    // tally marks in fives, each stroke a little crooked, in marker
    g.strokeStyle = '#1d4f8f'; g.lineWidth = 0.009 * px; g.lineCap = 'round';
    for (let k = 0; k < (counts[i] ?? 0); k++) {
      const grp = Math.floor(k / 5), j = k % 5, gx = x0 + grp * 0.085 * px, r = hashOf(`${o}${k}`), h = 0.036 * px;
      g.beginPath();
      if (j < 4) { const xx = gx + j * 0.016 * px; g.moveTo(xx + (r - 0.5) * 4, y - h); g.lineTo(xx - (r - 0.5) * 4, y + h); }
      else { g.moveTo(gx - 0.008 * px, y + h * 0.7); g.lineTo(gx + 0.056 * px, y - h * 0.7); }
      g.stroke();
    }
  });
  return done(c, key);
}
function paintingTexture(seed: number, bg: string): THREE.Texture {
  const key = `painting:${seed}:${bg}`; const hit = texCache.get(key); if (hit) return hit;
  const c = document.createElement('canvas'); c.width = 128; c.height = 96; const g = c.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, 128, 96); g.fillStyle = '#e9d9a6'; g.beginPath(); g.arc(92, 28, 14, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#5f8a4a'; g.beginPath(); g.moveTo(0, 70); g.quadraticCurveTo(40, 40 + (seed % 9), 80, 62); g.quadraticCurveTo(110, 50, 128, 66); g.lineTo(128, 96); g.lineTo(0, 96); g.fill();
  g.fillStyle = '#3f6e33'; g.fillRect(0, 82, 128, 14);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; texCache.set(key, t); return t;
}

registerMesh({
  gen: 'tag:sign-text',
  build(ctx) {
    bindMotionModel(ctx.model);
    const parsed = kitArgs.safeParse(ctx.args); if (!parsed.success) return null;
    const root = buildKit(parsed.data, ctx);
    if (typeof document === 'undefined') return root;
    const faces = (ctx.args.faces ?? []) as Face[];
    const st = ctx.entity.state ?? {};
    const text = typeof st.text === 'string' && st.text.trim() ? st.text.split('\n') : (ctx.def.components.sign?.lines ?? []);
    for (const f of faces) {
      let map: THREE.Texture;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(f.w, f.h));
      // W6: a media face shows its slot's image or looping video; a gallery wall's empty slots stay plain
      const found = f.media ? artOf(ctx.entity.id, st, f.slot) : null, src = found ? signMediaPath(found.url) : null;
      const art = found && src ? { ...found, url: src } : null;
      // a link the page cannot load (most often a web host without a CORS header, which WebGL needs) says so on the
      // face instead of staying black; hover still names the piece and its maker
      const broken = () => { const old = plane.material as THREE.MeshBasicMaterial; const t = textTexture(brokenLinkLines(art!.url), { ...f, bg: '#2f2a26', ink: '#e8dcc8' }); plane.material = new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, metalness: 0 }); old?.dispose?.(); plane.userData.art = { ...plane.userData.art, broken: true }; const uv = (plane.geometry as THREE.PlaneGeometry).attributes.uv as THREE.BufferAttribute; uv.setXY(0, 0, 1); uv.setXY(1, 1, 1); uv.setXY(2, 0, 0); uv.setXY(3, 1, 0); uv.needsUpdate = true; };
      if (art && art.kind === 'video') map = videoTexture(art.url, plane, broken);
      else if (art && loader && imageBroken(art.url)) { map = textTexture(brokenLinkLines(art.url), { ...f, bg: '#2f2a26', ink: '#e8dcc8' }); art.broken = true; }
      else if (art && loader) { const url = art.url; map = texCache.get(url) ?? loader.load(url, () => imageLoaded(url), undefined, () => { texCache.delete(url); imageFailed(url); }); map.colorSpace = THREE.SRGBColorSpace; texCache.set(url, map); whenImageFails(url, broken); }
      else if (f.media && f.slot !== undefined) map = textTexture([''], f);
      else if (f.media && text.length && typeof st.text === 'string' && st.text.trim()) map = textTexture(text.slice(0, 6), f);
      else if (f.media) map = paintingTexture(ctx.def.name.length + (ctx.entity.seed ?? 0), f.bg ?? '#7fa7c9');
      else if (ctx.def.tags.includes('pinboard')) map = pinboardTexture(typeof st.text === 'string' ? st.text.split('\n') : [], f);
      else if (ctx.def.tags.includes('signup')) map = signupTexture(String(st.title ?? ''), typeof st.text === 'string' && st.text ? st.text.split('\n') : [], f);
      else if (ctx.def.tags.includes('poll')) { const opts = pollOptions(st), votes = typeof st.textBy === 'string' && st.textBy ? st.textBy.split(',').map((v) => Number(v.split(':')[1])) : []; map = pollTexture(String(st.title ?? ''), opts, opts.map((_, i) => votes.filter((v) => v === i).length), f); }
      else if (ctx.def.tags.includes('chalkboard') && ctx.def.tags.includes('hand-writable')) map = chalkTexture(text, f);
      else map = textTexture((f.line !== undefined ? [text[f.line] ?? ''] : text).slice(0, 6), f);
      // video and images glow a little so art reads in dim rooms; text keeps the matte board look
      plane.material = art ? new THREE.MeshBasicMaterial({ map, toneMapped: false }) : new THREE.MeshStandardMaterial({ map, roughness: 0.85, metalness: 0 });
      plane.position.set(...f.at); plane.rotation.set(f.pitch ?? 0, f.yaw ?? 0, 0, 'YXZ'); plane.name = 'sign-face';
      if (art) { plane.userData.art = art; coverWhenReady(map, plane.geometry as THREE.PlaneGeometry, f.w / f.h); }
      root.add(plane);
    }
    return root;
  },
});
