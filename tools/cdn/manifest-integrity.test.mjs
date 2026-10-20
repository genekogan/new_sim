import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const json = async path => JSON.parse(await readFile(join(root, path), 'utf8'));

// Resolve the prepared artifact independently of inventory.mjs. A path alias must name real world bytes; a
// content-addressed alias must resolve through the server's core set (worlds/core-assets/index.json + *.index.json),
// to the bytes GET /assets/<sha> sends: the rendition (renditions.json) when one exists, else the file itself.
function manifestFile(alias, entry, core, renditions) {
  const canonical = /^(?:\/worlds)?\/assets\/([a-f0-9]{64})\.([a-z0-9]+)$/.exec(alias);
  if (canonical) {
    const [, sha, ext] = canonical;
    const asset = core[sha];
    assert.ok(asset, `${alias}: no core index file for this hash`);
    assert.equal(asset.ext, ext, `${alias}: core index extension differs`);
    const ren = ext === 'glb' ? renditions[sha] : undefined;
    assert.equal(entry.of, ren ? sha : undefined, `${alias}: a rendition alias names its requested sha in 'of', no other alias does`);
    assert.equal(entry.sha256, ren ? ren.sha : sha, `${alias}: must carry the bytes the origin route sends`);
    return ren ? ren.path : asset.path;
  }
  if (alias.startsWith('/blobs/')) return alias;   // BLOBS: checked against served-blobs.json below
  const named = /^(?:\/worlds)?\/world-assets\/(.+)$/.exec(alias);
  assert.ok(named, `${alias}: unknown prepared manifest alias`);
  assert.equal(entry.of, undefined, `${alias}: only hash aliases may be renditions`);
  return 'worlds/' + named[1];
}

async function actualWorldBytes(path) {
  const parts = path.split('/');
  assert.equal(parts[0], 'worlds', `${path}: file must be inside repo worlds/`);
  assert.ok(parts.length > 1 && parts.every(p => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(p)), `${path}: unsafe world file path`);
  let file = root;
  for (const [i, part] of parts.entries()) {
    file = join(file, part);
    const info = await lstat(file);
    assert.ok(!info.isSymbolicLink(), `${path}: world file path must not follow symlinks`);
    assert.ok(i === parts.length - 1 ? info.isFile() : info.isDirectory(), `${path}: unresolvable world file path`);
  }
  const bytes = await readFile(file);
  return { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
}

test('every prepared CDN alias matches independently hashed on-disk world files', async t => {
  const dir = join(root, 'worlds/core-assets');
  const [manifest, reviewed, served, ren, blobs] = await Promise.all([
    json('apps/web/src/cdn-manifest.json'), json('tools/cdn/approved-derivatives.json'), json('tools/cdn/served-public.json'), json('worlds/core-assets/renditions.json'), json('tools/cdn/served-blobs.json'),
  ]);
  const core = {};
  for (const name of ['index.json', ...(await readdir(dir)).filter(n => n.endsWith('.index.json')).sort()]) {
    for (const [sha, a] of Object.entries((await json('worlds/core-assets/' + name)).assets)) core[sha] ??= a;
  }
  assert.equal(manifest.version, 1);
  const entries = Object.entries(manifest.assets);
  const files = new Map();
  let namedCount = 0, canonicalCount = 0, blobCount = 0;
  for (const [alias, entry] of entries) {
    assert.match(entry.sha256, /^[a-f0-9]{64}$/, `${alias}: invalid SHA-256`);
    assert.ok(Number.isSafeInteger(entry.bytes) && entry.bytes > 0, `${alias}: invalid byte count`);
    const path = manifestFile(alias, entry, core, ren.renditions);
    if (path.startsWith('/blobs/')) {
      const record = blobs.objects.find(b => b.blob === alias);
      assert.ok(record && record.sha256 === entry.sha256 && record.bytes === entry.bytes && alias.includes(`/${entry.sha256.slice(0, 2)}/${entry.sha256}.`), `${alias}: no matching BLOBS record`);
      blobCount++; continue;   // its local copy lives outside the repo; publish.mjs rehashes it before any upload
    }
    if (!files.has(path)) files.set(path, await actualWorldBytes(path));
    assert.deepEqual(files.get(path), { sha256: entry.sha256, bytes: entry.bytes }, `${alias}: prepared bytes differ from ${path}`);
    const record = entry.licence === 'served-public' ? served.objects.find(r => r.sha256 === entry.sha256) : reviewed.derivatives.find(d => d.sha256 === entry.sha256);
    assert.ok(record && record.bytes === entry.bytes, `${alias}: no ${entry.licence} record for these bytes`);
    if (/^\/(?:worlds\/)?world-assets\//.test(alias)) namedCount++;
    else canonicalCount++;
  }
  // CDN2 (Gene, 2026-10-20): the whole core set, private Mars College and Little Martians files included, is published.
  const glbs = Object.values(core).filter(a => a.ext === 'glb').length;
  assert.equal(canonicalCount, 2 * glbs, 'both hash namespaces for every core-set GLB');
  const objects = new Set([...files.values()].map(f => f.sha256));
  assert.equal(objects.size, reviewed.derivatives.length + served.objects.length, 'every reviewed and served-public object, nothing else');
  assert.equal(namedCount, 2 * files.size, 'both named world-assets namespaces for every file');
  assert.equal(blobCount, blobs.objects.length, 'every client BLOBS file');
  const lods = (await json('worlds/core-assets/lods.index.json')).assets;
  for (const sha of Object.keys(lods)) assert.ok(manifest.assets[`/assets/${sha}.glb`] && manifest.assets[`/worlds/assets/${sha}.glb`], `lod ${sha} is published`);
  t.diagnostic(`${entries.length} aliases verified against ${files.size} independently hashed files (${[...files.values()].reduce((n, f) => n + f.bytes, 0)} unique bytes)`);
});
