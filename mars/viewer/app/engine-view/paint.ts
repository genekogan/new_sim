// Paint progress on a paintable face (engine/work/paint.ts, SOLAR_PAINT.md "Renderer contract"): the
// entity's `paint = { face, color | texture, coverage, bands: [{ from, to, coverage }] }` drawn as one
// colour or image quad per band on that face, 3 mm off it, as wide as the band's coverage (from the face's left
// edge as seen by a painter facing it: coverage is an area fraction, not a mask, and the brush works
// row by row across the face). Known texture names use existing history images; unknown names retain a
// stable hashed colour and dark stripe so no scene silently pretends an unavailable image was applied.
// The face frame comes from the engine (`faceOf` at the entity's tick pose) and is rebuilt in the
// object's local frame, so the overlay rides the part's interpolated render pose.
import * as THREE from 'three';
import type { Entity, PaintState } from '../../engine/world/types.ts';
import { faceOf } from '../../engine/work/paint.ts';
import { isArchivePhoto } from '../history/archive-photos.ts';

const OFF = 0.003; // m off the face
const STRIPE = 0.02; // m: texture stripe height
export const PAINT_TEXTURES: Readonly<Record<string, string>> = Object.freeze({
  'flower-mural': '/history/2024/flower.webp',
  'flower-mural-2024': '/history/2024/flower.webp',
  'flower-mural-2025': '/history/2025/flower.webp',
  'red-wall-2024': '/history/2024/red-wall.webp',
  'orange-wall-2024': '/history/2024/orange-wall.webp',
  'eye-2024': '/history/2024/eye.webp',
  'arches-2022': '/history/2022/arches.webp',
  'arches-upper-2022': '/history/2022/arches-upper.webp',
  'swirls-2023': '/history/2023/swirls.webp',
  'cafe-front-2023': '/history/2023/cafe-front.webp',
});
type SharedImage = { image: THREE.Texture; users: number };
const loaded = new Map<string, SharedImage>();
const warned = new Set<string>();
export function paintTexturePath(name: string): string | null {
  const path = PAINT_TEXTURES[name];
  if (!path) {
    if (!warned.has(name)) { warned.add(name); console.warn(`[paint] unknown texture "${name}"; using hashed colour and stripe`); }
    return null;
  }
  return isArchivePhoto(path) ? null : path; // archive photos are not distributed: hashed colour and stripe
}
function acquireImage(path: string): SharedImage {
  let shared = loaded.get(path);
  if (!shared) {
    const image = new THREE.TextureLoader().load(path, (texture: THREE.Texture) => {
      // TextureLoader assigns the decoded image before this callback. A former
      // world may have released its last user while that request was pending.
      if (shared?.users === 0) texture.source.data = null;
    });
    image.colorSpace = THREE.SRGBColorSpace;
    image.anisotropy = 4;
    shared = { image, users: 0 };
    loaded.set(path, shared);
  }
  shared.users++;
  return shared;
}

/** Colour of a paint state: its CSS colour, else a stable colour hashed from the texture name. */
export function paintColor(p: Pick<PaintState, 'color' | 'texture'>): THREE.Color {
  if (p.color) {
    try {
      return new THREE.Color(p.color);
    } catch {
      /* unknown CSS colour: fall through */
    }
  }
  let h = 0;
  for (const c of p.texture ?? p.color ?? '') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return new THREE.Color().setHSL((h % 360) / 360, 0.45, 0.55);
}

export class PaintOverlay {
  readonly group = new THREE.Group();
  private key = '';
  private mat?: THREE.MeshStandardMaterial;
  private stripe?: THREE.MeshStandardMaterial;
  private image?: { path: string; shared: SharedImage };
  /** What is drawn (tests): face, colour, per band the drawn width fraction. */
  state?: { face: string; color: string; texture: string | null; bands: { from: number; to: number; coverage: number; drawn: number }[] };

  constructor(parent: THREE.Object3D) {
    this.group.name = 'paint';
    parent.add(this.group);
  }

  update(e: Entity) {
    const p = e.paint;
    const key = p ? `${p.face}|${p.color ?? ''}|${p.texture ?? ''}|${p.bands.map((b) => b.coverage).join(',')}|${e.pose.p.join(',')}|${e.pose.yaw},${e.pose.pitch ?? 0},${e.pose.roll ?? 0}` : '';
    if (key === this.key) return;
    this.key = key;
    this.clearMeshes();
    this.state = undefined;
    if (!p) { this.releaseImage(); return; }
    const F = faceOf(e, p.face);
    if ('code' in F) { this.releaseImage(); return; } // lying sheet: no upright paint face
    // world → the object's local frame at the engine pose (the object is posed with the same Euler)
    const inv = new THREE.Matrix4().compose(new THREE.Vector3(...e.pose.p), new THREE.Quaternion().setFromEuler(new THREE.Euler(e.pose.pitch ?? 0, -e.pose.yaw, e.pose.roll ?? 0, 'YXZ')), new THREE.Vector3(1, 1, 1)).invert();
    const toLocal = (w: number[]) => new THREE.Vector3(w[0], w[1], w[2]).applyMatrix4(inv);
    const nrm = new THREE.Vector3(...F.N).multiplyScalar(OFF);
    const at = (u: number, h: number) => toLocal([F.B[0] + F.U[0] * u + F.V[0] * h + nrm.x, F.B[1] + F.U[1] * u + F.V[1] * h + nrm.y, F.B[2] + F.U[2] * u + F.V[2] * h + nrm.z]);
    const path = p.texture ? paintTexturePath(p.texture) : null;
    if (path !== (this.image?.path ?? null)) {
      this.releaseImage();
      if (path) this.image = { path, shared: acquireImage(path) };
    }
    const image = this.image?.shared.image ?? null;
    const color = image ? new THREE.Color('#ffffff') : paintColor(p);
    this.mat = new THREE.MeshStandardMaterial({ color, map: image, roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    if (p.texture && !image) this.stripe = new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.35), roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const bands = p.bands.map((b) => {
      const top = Math.min(b.to, F.height), w = F.width * Math.max(0, Math.min(1, b.coverage));
      if (w > 1e-4 && top > b.from) {
        this.group.add(this.quad(at(0, b.from), at(w, b.from), at(w, top), at(0, top), this.mat!, b.coverage, b.from / F.height, top / F.height));
        if (this.stripe) {
          const m = (b.from + top) / 2;
          this.group.add(this.quad(at(0, m - STRIPE / 2), at(w, m - STRIPE / 2), at(w, m + STRIPE / 2), at(0, m + STRIPE / 2), this.stripe));
        }
      }
      return { from: b.from, to: b.to, coverage: b.coverage, drawn: +(w / F.width).toFixed(3) };
    });
    this.state = { face: p.face, color: `#${color.getHexString()}`, texture: p.texture ?? null, bands };
  }

  private quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, m: THREE.Material, u = 1, v0 = 0, v1 = 1) {
    const g = new THREE.BufferGeometry().setFromPoints([a, b, c, a, c, d]);
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, v0, u, v0, u, v1, 0, v0, u, v1, 0, v1], 2));
    g.computeVertexNormals();
    const q = new THREE.Mesh(g, m);
    q.receiveShadow = true;
    return q;
  }

  private clearMeshes() {
    for (const o of this.group.children) (o as THREE.Mesh).geometry.dispose();
    this.group.clear();
    this.mat?.dispose();
    this.stripe?.dispose();
    this.mat = this.stripe = undefined;
  }

  private releaseImage() {
    if (!this.image) return;
    const { path, shared } = this.image;
    this.image = undefined;
    if (--shared.users === 0) {
      shared.image.dispose();
      shared.image.source.data = null;
      loaded.delete(path);
    }
  }

  dispose() {
    this.clearMeshes();
    this.releaseImage();
    this.group.removeFromParent();
  }
}
