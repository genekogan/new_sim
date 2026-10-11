// Shared bits of the littlemartians-two scripts (lane LM, 2026-10-11).
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
/** lm/map's LM-22 world content (Gene, 2026-10-11). Later lm/map commits hold unaccepted temple experiments: excluded. */
export const LM_MAP_COMMIT = '953613972438611c336b4cb5733390e47aed3290';
/** The same words as the core LM assets (tools/god-skill/scripts/import-packs.mjs). */
export const LM_LICENSE = 'Vanessa Rosa (Little Martians); private to this project — not for redistribution outside it without the artist\'s permission';

const pnpm = join(root, 'node_modules/.pnpm');
const find = (prefix) => { const d = execFileSync('ls', [pnpm], { encoding: 'utf8' }).split('\n').filter((x) => x.startsWith(prefix)).sort().pop(); if (!d) throw new Error(`pnpm store lacks ${prefix}`); return join(pnpm, d, 'node_modules'); };
export function gltfTransform() {
  const req = createRequire(join(find('@gltf-transform+functions@4.5'), '@gltf-transform/functions/package.json'));
  return { core: req('@gltf-transform/core'), ext: req('@gltf-transform/extensions'), fn: req('@gltf-transform/functions'), sharp: createRequire(join(find('sharp@0.35'), 'sharp/package.json'))('sharp') };
}

/**
 * A gallery panel GLB: the picture (6 × 4 m, 1–5 m above the ground, facing +z) on a dark basalt frame with two
 * feet. The picture is the image embedded in lm/map's landscape.glb under the material named `title`.
 */
export async function makePanel(landscapeGlb, title) {
  const { core, ext, sharp } = gltfTransform();
  const io = new core.NodeIO().registerExtensions(ext.ALL_EXTENSIONS);
  const src = await io.readBinary(new Uint8Array(landscapeGlb));
  const mat = src.getRoot().listMaterials().find((m) => m.getName() === title);
  const tex = mat?.getBaseColorTexture(); if (!tex) throw new Error(`landscape has no picture "${title}"`);
  const webp = await sharp(Buffer.from(tex.getImage())).resize(1536, 1536, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 84 }).toBuffer();
  const doc = new core.Document(); doc.createExtension(ext.EXTTextureWebP).setRequired(true);
  const buf = doc.createBuffer();
  const scene = doc.createScene(title);
  const prim = (pos, nor, uv, idx, material) => {
    const p = doc.createPrimitive().setMaterial(material)
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buf))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buf))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(buf));
    if (uv) p.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buf));
    return p;
  };
  /** An axis-aligned box [x0,y0,z0,x1,y1,z1] as 6 quads. */
  const box = ([x0, y0, z0, x1, y1, z1]) => {
    const pos = [], nor = [], idx = [];
    const quad = (a, b, c, d, n) => { const k = pos.length / 3; pos.push(...a, ...b, ...c, ...d); for (let i = 0; i < 4; i++) nor.push(...n); idx.push(k, k + 1, k + 2, k, k + 2, k + 3); };
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]); quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]);
    quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]); quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]);
    quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]); quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);
    return { pos, nor, idx };
  };
  const basalt = doc.createMaterial('dark-basalt').setBaseColorFactor([0.11, 0.065, 0.095, 1]).setRoughnessFactor(0.9).setMetallicFactor(0);
  const picture = doc.createMaterial(title).setBaseColorTexture(doc.createTexture(title).setMimeType('image/webp').setImage(new Uint8Array(webp))).setRoughnessFactor(1).setMetallicFactor(0);
  const frame = doc.createMesh('frame');
  for (const b of [[-3.25, 0.8, -0.16, 3.25, 5.2, 0.04], [-2.9, 0, -0.3, -2.4, 0.8, 0.2], [2.4, 0, -0.3, 2.9, 0.8, 0.2]]) { const g = box(b); frame.addPrimitive(prim(g.pos, g.nor, null, g.idx, basalt)); }
  const pic = doc.createMesh('picture').addPrimitive(prim([-3, 1, 0.05, 3, 1, 0.05, 3, 5, 0.05, -3, 5, 0.05], [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], [0, 1, 1, 1, 1, 0, 0, 0], [0, 1, 2, 0, 2, 3], picture));
  scene.addChild(doc.createNode('frame').setMesh(frame)).addChild(doc.createNode('picture').setMesh(pic));
  return Buffer.from(await io.writeBinary(doc));
}
