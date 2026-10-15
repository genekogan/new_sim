import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const json = async path => JSON.parse(await readFile(join(root, path), 'utf8'));

// Resolve the prepared artifact independently of inventory.mjs. A path alias must name
// real world bytes; a content-addressed alias must resolve through the reviewed core index.
function manifestFile(alias, entry, index, reviewed) {
  const canonical = /^(?:\/worlds)?\/assets\/([a-f0-9]{64})\.([a-z0-9]+)$/.exec(alias);
  if (canonical) {
    const [, sha, ext] = canonical;
    assert.equal(entry.sha256, sha, `${alias}: filename must match its declared SHA-256`);
    const asset = index.assets[sha];
    assert.ok(asset, `${alias}: no core index file for this hash`);
    assert.equal(asset.ext, ext, `${alias}: core index extension differs`);
    assert.ok(reviewed.derivatives.some(d => d.sha256 === sha && d.bytes === entry.bytes && d.path === asset.path), `${alias}: no reviewed core output`);
    return asset.path;
  }
  const named = /^(?:\/worlds)?\/world-assets\/(.+)$/.exec(alias);
  assert.ok(named, `${alias}: unknown prepared manifest alias`);
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

test('all 304 prepared CDN aliases match independently hashed on-disk world files', async t => {
  const [manifest, index, reviewed] = await Promise.all([
    json('apps/web/src/cdn-manifest.json'),
    json('worlds/core-assets/index.json'),
    json('tools/cdn/approved-derivatives.json'),
  ]);
  assert.equal(manifest.version, 1);
  const entries = Object.entries(manifest.assets);
  assert.equal(entries.length, 304, 'retain the complete prepared publication manifest');
  const files = new Map();
  let namedCount = 0, canonicalCount = 0;
  for (const [alias, entry] of entries) {
    assert.match(entry.sha256, /^[a-f0-9]{64}$/, `${alias}: invalid SHA-256`);
    assert.ok(Number.isSafeInteger(entry.bytes) && entry.bytes > 0, `${alias}: invalid byte count`);
    const path = manifestFile(alias, entry, index, reviewed);
    if (!files.has(path)) files.set(path, await actualWorldBytes(path));
    assert.deepEqual(files.get(path), { sha256: entry.sha256, bytes: entry.bytes }, `${alias}: prepared bytes differ from ${path}`);
    if (/^\/(?:worlds\/)?world-assets\//.test(alias)) namedCount++;
    else canonicalCount++;
  }
  assert.equal(namedCount, 152, 'verify both named world-assets namespaces');
  assert.equal(canonicalCount, 152, 'verify both canonical asset namespaces');
  assert.equal(files.size, 76, 'all prepared aliases resolve to the 76 reviewed files');
  t.diagnostic(`${entries.length} aliases verified against ${files.size} independently hashed files (${[...files.values()].reduce((n, f) => n + f.bytes, 0)} unique bytes)`);
});
