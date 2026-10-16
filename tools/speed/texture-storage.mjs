// Texture payload storage for performance probes. Compressed mip bytes are the transcoder's actual blocks;
// ordinary RGBA8 storage is estimated from the fitted image dimensions and generated mip chain.
// This excludes driver overhead, render targets and textures that are not referenced by the entity scene.
export function textureStorage(scene) {
  const seen = new Set();
  let compressedTextures = 0, compressedMipBytes = 0, estimatedUncompressedBytes = 0, unknownTextures = 0;
  scene.traverse((o) => {
    for (const mat of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
      for (const t of Object.values(mat)) {
        if (!t?.isTexture || seen.has(t)) continue;
        seen.add(t);
        if (t.isCompressedTexture) {
          compressedTextures++;
          const levels = t.mipmaps ?? [];
          if (!levels.length || levels.some((m) => !ArrayBuffer.isView(m.data))) { unknownTextures++; continue; }
          compressedMipBytes += levels.reduce((n, m) => n + m.data.byteLength, 0);
        } else {
          let w = t.image?.width, h = t.image?.height;
          // Only imported 2D RGBA8 images, not float/data/cube textures, are estimated here.
          if (!(w > 0 && h > 0) || t.isDataTexture || t.isCubeTexture || (t.type !== undefined && t.type !== 1009)) { unknownTextures++; continue; }
          for (;;) {
            estimatedUncompressedBytes += w * h * 4;
            if (!t.generateMipmaps || (w === 1 && h === 1)) break;
            w = Math.max(1, Math.floor(w / 2)); h = Math.max(1, Math.floor(h / 2));
          }
        }
      }
    }
  });
  return { textures: seen.size, compressedTextures, compressedMipBytes, estimatedUncompressedBytes, unknownTextures };
}
