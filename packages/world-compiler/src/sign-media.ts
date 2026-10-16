import type { WorldModel } from './model.ts';
import type { Failure, StoredDef } from './schemas.ts';

const VIDEO = /\.(mp4|webm|mov|m4v)$/i;
/** Frame media (Gene 2026-10-16: frames may show web links and video, no moderation for now). One reference is an
 *  http(s) URL or a same-site path (`/assets/<sha>.png`, `/w/<world>/art/<sha>.mp4`, …), at most 480 characters,
 *  no spaces, quotes, angle brackets or backslashes. Never `data:`, `javascript:`, `blob:` or protocol-relative `//`.
 *  Videos are .mp4/.webm/.mov/.m4v (or a URL ending `#video`) and loop muted in the viewer. Shared by the compiler,
 *  the art routes and the viewer so all three read a reference the same way. */
export function frameMediaKind(ref: unknown): 'image' | 'video' | null {
  if (typeof ref !== 'string' || !ref || ref.length > 480 || /[\s"'<>\\\u0000-\u001f\u007f]/.test(ref)) return null;
  if (ref.startsWith('//')) return null;
  if (!ref.startsWith('/')) {
    if (!/^https?:\/\//i.test(ref)) return null;
    let u: URL; try { u = new URL(ref); } catch { return null; }
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname || u.username || u.password) return null;
  }
  return VIDEO.test(ref.split(/[?#]/)[0]) || /#video$/.test(ref) ? 'video' : 'image';
}
/** The media lines of a display (one per slot; an empty line is an empty slot). */
export const MEDIA_SLOTS_MAX = 8;

/** A sign/frame/screen's `media` state: one frame-media reference per line (at most 8 lines), or empty. */
export function signMediaFailure(w: WorldModel, def: StoredDef, media: unknown, op: number, entity?: string): Failure | null {
  const faces = def.make.kind === 'gen' && def.make.gen === 'kit/2' ? def.make.args?.faces : undefined;
  const sign = def.tags.includes('sign-text') || !!def.components.sign || (Array.isArray(faces) && faces.some(f => f && typeof f === 'object' && 'media' in f && f.media));
  if (!sign || media === undefined || media === '') return null;
  const lines = typeof media === 'string' ? media.split('\n').map(l => l.trim()) : null;
  const bad = lines === null ? media : lines.length > MEDIA_SLOTS_MAX ? `${lines.length} lines` : lines.find(l => l && !frameMediaKind(l));
  // Release 2 kept: a `/assets/…` line must be an image asset of THIS world (worlds can share one asset directory).
  const foreign = lines?.find(l => l.startsWith('/assets/') && (([, sha, ext]) => !sha || w.assets(sha)?.image?.ext !== ext)(/^\/assets\/([0-9a-f]{64})\.(png|jpg)$/.exec(l) ?? []));
  if (bad === undefined && foreign === undefined) return null;
  if (bad === undefined) return { op, code: 'params.invalid', field: 'state.media', def: def.ref, ...(entity ? { entity } : {}), measured: foreign,
    detail: 'A /assets/ path in frame media must be an image asset of this world (/assets/<sha>.png or .jpg).',
    fix: 'Upload the image to this world with POST /v1/god/assets, then use its /assets/<sha>.<ext> path; or use an https:// link.' };
  return { op, code: 'params.invalid', field: 'state.media', def: def.ref, ...(entity ? { entity } : {}), measured: bad,
    detail: 'Frame media must be http(s) web links or same-site paths (images or .mp4/.webm/.mov/.m4v video), one per line, at most 8 lines; never data:, javascript: or // links.',
    fix: 'Use an https:// link, or upload with POST /v1/art/media (or POST /v1/god/assets) and use the path it returns; or clear state.media.' };
}
