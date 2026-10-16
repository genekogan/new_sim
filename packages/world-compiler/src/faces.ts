// XP8 admission: faces and decals may show only image assets registered to this world (the WD8 sign-media rule), and a
// building's decals must name one of its own wall slots. Refusals are `params.invalid` with the field and a fix.
import { FACE_IMAGE, FACE_LIMITS, decalSchema, faceContentIssues, type Slot } from '@sim/generators';
import type { WorldModel } from './model.ts';
import type { Failure, StoredDef } from './schemas.ts';

const UPLOAD = 'Upload the image to this world with POST /v1/god/assets, then use its /assets/<sha>.<ext> path.';
const rank = (id: string) => ['facade-', 'gable-', 'opening-'].findIndex(p => id.startsWith(p)) >>> 0;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
type Fail = (field: string, measured: unknown, detail: string, fix: string) => Failure;
const failer = (op: number, def: StoredDef, entity?: string): Fail => (field, measured, detail, fix) =>
  ({ op, code: 'params.invalid', field, def: def.ref, ...(entity ? { entity } : {}), measured, detail, fix });

function imageFailure(w: WorldModel, image: unknown, field: string, fail: Fail): Failure | null {
  const match = typeof image === 'string' ? FACE_IMAGE.exec(image) : null;
  if (match && w.assets(match[1])?.image?.ext === match[2]) return null;
  return fail(field, image, match ? `${image} is not an image asset of this world.` : 'Face images must be a same-origin image asset of this world (/assets/<sha>.png or .jpg); URLs, data: and other worlds are refused.', UPLOAD);
}

/** kit/2 faces as authored (before programs expand): every image is one of this world's image assets. */
export function kitFaceFailure(w: WorldModel, def: StoredDef, op: number): Failure | null {
  if (def.make.kind !== 'gen' || def.make.gen !== 'kit/2') return null;
  const shapes = def.make.args?.shapes, fail = failer(op, def);
  if (!Array.isArray(shapes)) return null;
  for (const [i, shape] of shapes.entries()) {
    const faces = record(shape) ? shape.faces : undefined;
    if (Array.isArray(faces)) for (const [j, face] of faces.entries()) if (record(face) && face.image !== undefined) {
      const failure = imageFailure(w, face.image, `make.args.shapes.${i}.faces.${j}.image`, fail); if (failure) return failure;
    }
  }
  return null;
}

/** building/1 decals: a short list of faces, each on one of this building's wall slots, images from this world. */
export function decalFailure(w: WorldModel, def: StoredDef, decals: unknown, slots: () => readonly Slot[], op: number, entity?: string): Failure | null {
  if (def.make.kind !== 'gen' || def.make.gen !== 'building/1' || decals === undefined || decals === null) return null;
  const fail = failer(op, def, entity);
  if (!Array.isArray(decals) || decals.length > FACE_LIMITS.decals) return fail('params.decals', Array.isArray(decals) ? decals.length : typeof decals, `decals must be a list of at most ${FACE_LIMITS.decals} faces`, 'Pass decals as a JSON list: [{"slot":"facade-f0-s-1","w":2,"h":0.5,"text":"BAKERY"}].');
  let walls: string[] | undefined;
  for (const [i, decal] of decals.entries()) {
    const at = `params.decals.${i}`;
    if (record(decal) && decal.image !== undefined) { const failure = imageFailure(w, decal.image, `${at}.image`, fail); if (failure) return failure; }
    const parsed = decalSchema.safeParse(decal);
    if (!parsed.success) {
      const issue = parsed.error.issues[0], field = [at, ...issue.path].join('.');
      return fail(field, record(decal) && issue.path.length ? decal[String(issue.path[0])] ?? 'missing' : typeof decal, `${field}: ${issue.message}`, 'Each decal is {slot, w, h (metres), at?:[right, up], and one of text, image or pattern}.');
    }
    const content = faceContentIssues(decal as Record<string, unknown>, true)[0];
    if (content) return fail([at, ...content.path].join('.'), (decal as Record<string, unknown>)[String(content.path[0])], content.message, content.fix);
    // Facade frames first (the usual homes for a sign), then opening sills and legacy hang points.
    walls ??= slots().filter(s => s.kind === 'wall').map(s => s.id).sort((a, b) => rank(a) - rank(b));
    if (!walls.includes(parsed.data.slot)) return fail(`${at}.slot`, parsed.data.slot, `${parsed.data.slot} is not a wall slot of this building`, `Use one of its wall slots (describe <building> lists them): ${walls.slice(0, 10).join(', ')}${walls.length > 10 ? ', …' : ''}.`);
  }
  return null;
}
