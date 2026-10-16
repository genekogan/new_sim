// Signs, boards, frames and screens (defs tagged `sign-text`): the kit/2 body plus text or media
// faces listed in make.args.faces. Text: entity state `text` (lines split by \n), else the def's
// `sign` component lines; a face with `line: n` shows only line n (signpost arrows). Media faces
// show state `media` (an image URL) or a small painting. Owner: L4.
import * as THREE from 'three';
import { kitArgs } from '@sim/generators';
import { buildKit } from '../kit.mesh.ts';
import { registerMesh } from '../registry.ts';
import { bindMotionModel } from '../motion.ts';
import { artOf, coverWhenReady, videoTexture } from '../art-media.ts';

type Face = { at: [number, number, number]; w: number; h: number; yaw?: number; pitch?: number; bg?: string; ink?: string; font?: string; line?: number; media?: boolean; slot?: number };
const texCache = new Map<string, THREE.Texture>();
const loader = typeof document !== 'undefined' ? new THREE.TextureLoader() : null;

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
      const art = f.media ? artOf(ctx.entity.id, st, f.slot) : null;
      if (art && art.kind === 'video') map = videoTexture(art.url, plane);
      else if (art && loader) { map = texCache.get(art.url) ?? loader.load(art.url); map.colorSpace = THREE.SRGBColorSpace; texCache.set(art.url, map); }
      else if (f.media && f.slot !== undefined) map = textTexture([''], f);
      else if (f.media && text.length && typeof st.text === 'string' && st.text.trim()) map = textTexture(text.slice(0, 6), f);
      else if (f.media) map = paintingTexture(ctx.def.name.length + (ctx.entity.seed ?? 0), f.bg ?? '#7fa7c9');
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
