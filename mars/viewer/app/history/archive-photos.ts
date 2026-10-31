import * as T from 'three';

// The Mars archive photos (/history/**, /2020/**) are not distributed with the repo or the CDN. Surfaces that used
// them as textures keep their geometry and material but take a plain neutral 1x1 texture instead, so nothing 404s.
export const isArchivePhoto = (url: string): boolean => /^\/(history|2020)\//.test(url);

const NEUTRAL = new Uint8Array([185, 173, 152, 255]); // #b9ad98, a weathered plaster tone

export function photoTexture(url: string): T.Texture {
  if (!isArchivePhoto(url)) return new T.TextureLoader().load(url);
  const texture = new T.DataTexture(NEUTRAL, 1, 1);
  texture.needsUpdate = true;
  texture.userData.archivePhoto = texture.userData.sourceUrl = url; // provenance only; nothing is fetched
  return texture;
}
