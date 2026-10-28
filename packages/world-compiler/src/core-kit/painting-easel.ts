// Paintings that stay: a new revision, preserving every byte of core/easel@1.
// The existing media-face pipeline supplies images and maker/title hover text.
import furniture from './furniture.json' with { type: 'json' };
import type { DefInput } from '../schemas.ts';

export const PAINTING_EASEL_DEF: DefInput = /* @__PURE__ */ (() => {
  const old = structuredClone(furniture.find(d => d.name === 'core-easel')!) as unknown as DefInput;
  if (old.make.kind !== 'gen') throw new Error('core/easel@1 must remain a kit definition');
  return { ...old, version: 2,
    tags: [...(old.tags ?? []), 'sign-text'],
    description: 'A painter’s easel. Finish painting to leave a picture on its canvas, with the Soul’s title and credit.',
    make: { ...old.make, args: { ...(old.make.args as Record<string, unknown>),
      // Square preserves the full 512-square recipe; portrait canvas is a mat.
      // Its plane sits in front of the legacy decorative paint patches.
      faces: [{ at: [0, 1.15, 0.205], w: 0.60, h: 0.60, media: true, bg: '#f4f2ec' }] } },
    state: { media: { type: 'string', max: 500, default: '' }, title: { type: 'string', max: 120, default: '' }, maker: { type: 'string', max: 160, default: '' } },
    components: { ...old.components, display: { w: 0.60, h: 0.60 } },
  };
})();
