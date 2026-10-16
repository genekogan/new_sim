// XP8 faces: text lines, one of this world's images, or a seeded stained-glass / mosaic pattern drawn on a kit/2 v2
// shape side (box, rbox, extrude caps), and wall decals on building/1 wall slots (B1 facade anchors). Data only; the
// viewer draws them (apps/web/src/gen-mesh/faces.ts) and never requests anything but this world's /assets/ images.
// Image registration is checked against the world's asset store by world-compiler/src/faces.ts.
import { z } from 'zod';
import { num, v2 } from './fields.ts';

export const FACE_SIDES = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const;
export const FACE_FONTS = ['serif', 'sans', 'mono', 'hand'] as const;
export const FACE_PATTERNS = ['stained-glass', 'mosaic'] as const;
/** The only image a face may show: a content-addressed image asset served by this world's own route. */
export const FACE_IMAGE = /^\/assets\/([0-9a-f]{64})\.(png|jpg)$/;
export const FACE_LIMITS = Object.freeze({ lines: 12, lineChars: 64, perShape: 6, perKit: 32, decals: 16, sizeM: 20 });
export type FaceSide = typeof FACE_SIDES[number];
/** Local outward normal of each side of an unrotated box (front = +z, right = +x as you face the front). */
export const FACE_NORMALS: Record<FaceSide, [number, number, number]> = { front: [0, 0, 1], back: [0, 0, -1], right: [1, 0, 0], left: [-1, 0, 0], top: [0, 1, 0], bottom: [0, -1, 0] };

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const content = {
  /** Lines (an array, or one string split at \n). A tab splits a line into a left and a right-aligned column. */
  text: z.union([z.string().max(FACE_LIMITS.lines * (FACE_LIMITS.lineChars + 1)), z.array(z.string().max(FACE_LIMITS.lineChars)).min(1).max(FACE_LIMITS.lines)]).optional(),
  font: z.enum(FACE_FONTS).optional(),
  ink: hex.optional(),
  bg: z.union([hex, z.literal('none')]).optional(),
  align: z.enum(['center', 'left']).optional(),
  image: z.string().max(200).optional(),
  pattern: z.enum(FACE_PATTERNS).optional(),
  seed: z.number().int().min(0).max(2 ** 31 - 1).optional(),
  palette: z.array(hex).min(2).max(8).optional(),
  cells: z.number().int().min(3).max(48).optional(),
  glow: num.min(0).max(1).optional(),
};
const CONTENT_KEYS = Object.keys(content);
export const shapeFaceSchema = z.object({ side: z.enum(FACE_SIDES).optional(), w: num.positive().max(FACE_LIMITS.sizeM).optional(), h: num.positive().max(FACE_LIMITS.sizeM).optional(), at: v2.optional(), ...content }).passthrough();
export const decalSchema = z.object({ slot: z.string().min(1).max(64), w: num.min(0.05).max(FACE_LIMITS.sizeM), h: num.min(0.05).max(FACE_LIMITS.sizeM), at: v2.optional(), ...content }).passthrough();
export type ShapeFace = z.infer<typeof shapeFaceSchema>;
export type Decal = z.infer<typeof decalSchema>;
export type FaceContent = Pick<ShapeFace, 'text' | 'font' | 'ink' | 'bg' | 'align' | 'image' | 'pattern' | 'seed' | 'palette' | 'cells' | 'glow'>;
const SHAPE_KEYS = new Set(['side', 'w', 'h', 'at', ...CONTENT_KEYS]);
const DECAL_KEYS = new Set(['slot', 'w', 'h', 'at', ...CONTENT_KEYS]);

export type FaceIssue = { path: (string | number)[]; message: string; fix: string };
/** Lines of a face's text, split at newlines. */
export const faceLines = (text: FaceContent['text']): string[] => text === undefined ? [] : (Array.isArray(text) ? text : text.split('\n'));

/** Content rules shared by shape faces and decals: exactly one of text, image or pattern; no inert fields. */
export function faceContentIssues(face: Record<string, unknown>, decal: boolean): FaceIssue[] {
  const out: FaceIssue[] = [], add = (key: string, message: string, fix: string) => out.push({ path: [key], message, fix });
  for (const key of Object.keys(face)) if (!(decal ? DECAL_KEYS : SHAPE_KEYS).has(key)) add(key, 'is not a face field', `remove ${key}; a face shows text, image or pattern`);
  const shown = (['text', 'image', 'pattern'] as const).filter(k => face[k] !== undefined);
  if (shown.length !== 1) add(shown[1] ?? 'text', shown.length ? `a face shows one thing, got ${shown.join(' + ')}` : 'a face needs text, image or pattern', shown.length ? 'split it into two faces' : 'add text:"…", image:"/assets/<sha>.png" or pattern:"stained-glass"|"mosaic"');
  const lines = faceLines(face.text as FaceContent['text']);
  if (face.text !== undefined) {
    if (lines.length > FACE_LIMITS.lines) add('text', `has ${lines.length} lines (max ${FACE_LIMITS.lines})`, 'use fewer lines or another face');
    if (lines.some(l => l.length > FACE_LIMITS.lineChars)) add('text', `a line exceeds ${FACE_LIMITS.lineChars} characters`, 'break long lines with \\n');
    if (lines.some(l => /[\u0000-\u0008\u000b-\u001f\u007f]/.test(l))) add('text', 'contains control characters', 'use printable text; \\t splits a price column');
  }
  if (typeof face.image === 'string' && !FACE_IMAGE.test(face.image)) add('image', 'must be this world\'s image asset /assets/<sha>.png or .jpg (no URLs, data: or other worlds)', 'upload the image with POST /v1/god/assets and use its /assets/<sha>.<ext> path');
  for (const key of ['font', 'ink', 'bg', 'align'] as const) if (face[key] !== undefined && face.text === undefined) add(key, 'has no effect without text', `remove ${key}`);
  for (const key of ['seed', 'palette', 'cells'] as const) if (face[key] !== undefined && face.pattern === undefined) add(key, 'has no effect without pattern', `remove ${key}`);
  return out;
}

export type FaceCarrier = { kind: string; yaw?: number; pitch?: number; roll?: number };
const rotate = ([x, y, z]: [number, number, number], s: FaceCarrier): [number, number, number] => {
  const roll = s.roll ?? 0, pitch = s.pitch ?? 0, yaw = s.yaw ?? 0;
  [x, y] = [x * Math.cos(roll) - y * Math.sin(roll), x * Math.sin(roll) + y * Math.cos(roll)];
  [y, z] = [y * Math.cos(pitch) - z * Math.sin(pitch), y * Math.sin(pitch) + z * Math.cos(pitch)];
  return [x * Math.cos(yaw) + z * Math.sin(yaw), y, -x * Math.sin(yaw) + z * Math.cos(yaw)];
};
/** Which of the shape's own sides shows a face asked for `side` of the kit: the side (a box's six, an extrude's two caps)
 *  whose normal, after the shape's yaw/pitch/roll, looks most that way. Scale is ignored, so a mirrored copy carries its
 *  face to the mirror-image side. `align` is the cosine between the two directions. */
export function faceLocalSide(sh: FaceCarrier, side: FaceSide = 'front'): { local: FaceSide; align: number } {
  const want = FACE_NORMALS[side], candidates: FaceSide[] = sh.kind === 'extrude' ? ['top', 'bottom'] : [...FACE_SIDES];
  let best: { local: FaceSide; align: number } = { local: candidates[0], align: -Infinity };
  for (const local of candidates) { const n = rotate(FACE_NORMALS[local], sh), align = n[0] * want[0] + n[1] * want[1] + n[2] * want[2]; if (align > best.align + 1e-9) best = { local, align }; }
  return best;
}
/** Width and height (along the side's right and up) of a box side in the shape's own units. */
export function boxSideSize(size: [number, number, number], local: FaceSide): [number, number] {
  return local === 'left' || local === 'right' ? [size[2], size[1]] : local === 'top' || local === 'bottom' ? [size[0], size[2]] : [size[0], size[1]];
}
/** Triangles a shape's faces add (two per box face; an extrude cap is its outline triangulated). */
export function faceTriangles(sh: { kind: string; faces?: unknown[]; polygon?: unknown[]; holes?: unknown[][] }): number {
  const n = sh.faces?.length ?? 0;
  return n && (sh.kind === 'extrude' ? n * ((sh.polygon?.length ?? 3) + (sh.holes ?? []).reduce((a, p) => a + p.length + 2, 0)) : n * 2);
}
