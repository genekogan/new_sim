import type { WorldModel } from './model.ts';
import type { Failure, StoredDef } from './schemas.ts';

/** Only world-owned/core image assets can become a viewer request. No URLs, redirects or data URIs. */
export function signMediaFailure(w: WorldModel, def: StoredDef, media: unknown, op: number, entity?: string): Failure | null {
  const faces = def.make.kind === 'gen' && def.make.gen === 'kit/2' ? def.make.args?.faces : undefined;
  const sign = def.tags.includes('sign-text') || !!def.components.sign || (Array.isArray(faces) && faces.some(f => f && typeof f === 'object' && 'media' in f && f.media));
  if (!sign || media === undefined || media === '') return null;
  const match = typeof media === 'string' ? /^\/assets\/([0-9a-f]{64})\.(png|jpg)$/.exec(media) : null;
  if (match && w.assets(match[1])?.image?.ext === match[2]) return null;
  return { op, code: 'params.invalid', field: 'state.media', def: def.ref, ...(entity ? { entity } : {}), measured: media,
    detail: 'Sign media must be a same-origin image asset of this world (/assets/<sha>.png or .jpg).',
    fix: 'Upload the image to this world with POST /v1/god/assets, then use its /assets/<sha>.<ext> path, or clear state.media.' };
}
