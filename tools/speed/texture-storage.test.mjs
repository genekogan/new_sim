import test from 'node:test';
import assert from 'node:assert/strict';
import { textureStorage } from './texture-storage.mjs';
const scene = (...materials) => ({ traverse(fn) { for (const material of materials) fn({ material }); } });
test('texture estimate counts a shared RGBA8 mip chain only once', () => {
  const t = { isTexture: true, type: 1009, image: { width: 4, height: 4 }, generateMipmaps: true };
  const s = textureStorage(scene({map:t,normalMap:t}, [{map:t}]));
  assert.equal(s.textures,1); assert.equal(s.estimatedUncompressedBytes,(16+4+1)*4); assert.equal(s.unknownTextures,0);
});
test('compressed blocks use actual byte lengths and unknown formats remain explicit', () => {
  const t = { isTexture: true, isCompressedTexture: true, mipmaps: [{data:new Uint8Array(64)}, {data:new Uint8Array(16)}] };
  const unknown = {isTexture:true,isDataTexture:true,image:{width:4,height:4}};
  const s = textureStorage(scene({map:t,normalMap:unknown}));
  assert.equal(s.compressedMipBytes,80); assert.equal(s.estimatedUncompressedBytes,0); assert.equal(s.unknownTextures,1);
});
