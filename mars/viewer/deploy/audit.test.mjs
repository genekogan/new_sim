import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
import { serveDownload } from './downloads.mjs';
const directory = new URL('../.cloudflare/audit/unit/', import.meta.url);
await mkdir(directory, { recursive: true });
const modulePath = new URL('audit-modules.mjs', directory);
await build({
  stdin: {
    contents: `export * from './lib/layout';export * from './lib/layout-transforms';export * from './lib/three-resources';export * from './lib/render-batches';export * from './lib/snapshot-order';export * from './simulation/model';export * from './simulation/shared';export * from './app/studio/ambience-math';`,
    resolveDir: process.cwd(),
  },
  outfile: modulePath.pathname,
  bundle: true,
  platform: 'node',
  format: 'esm',
  external: ['three', 'three/*', 'zod'],
});
const {
  nestedTransforms,
  applyNestedTransforms,
  validateLayout,
  ThreeResources,
  createRenderBatches,
  acceptsSnapshot,
  initialState,
  command,
  motionPose,
  hourAt,
  CampusPaths,
} = await import(modulePath.href);
process.on('exit', () => {
  void rm(modulePath, { force: true });
});
const edit = {
  id: 'chiba',
  position: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
  scale: [1, 1, 1],
};
const layout = (edits) => ({
  schema_version: 1,
  base_model: 'mars-campus-modular-v1',
  units: 'metres',
  up: 'Y',
  edits,
});
const validate = (data) =>
  validateLayout(data, new Set(['chiba']), new Set(['timber_template']));
test('layout import rejects malformed, destructive, duplicate and unknown edits', () => {
  assert.equal(validate(layout([edit])).edits.length, 1);
  for (const edits of [
    [{ ...edit, position: null }],
    [{ ...edit, scale: [0, 1, 1] }],
    [{ ...edit, scale: [-1, 1, 1] }],
    [{ ...edit, quaternion: [0, 0, 0, 0] }],
    [edit, edit],
    [{ ...edit, id: 'missing' }],
    [{ ...edit, added: 'timber_template' }],
    [{ ...edit, id: 'new', added: 'copy:missing' }],
  ])
    assert.throws(() => validate(layout(edits)));
  assert.equal(
    validate(layout([{ ...edit, id: 'new', added: 'copy:chiba' }])).edits
      .length,
    1,
  );
  assert.throws(() =>
    validate(
      layout(
        Array.from({ length: 301 }, (_, i) => ({
          ...edit,
          id: `new-${i}`,
          added: 'timber_template',
        })),
      ),
    ),
  );
});
test('resource owner releases shared geometries, alternate materials and every texture once', () => {
  const resources = new ThreeResources(),
    texture = new THREE.Texture(),
    normal = new THREE.Texture(),
    geometry = new THREE.BoxGeometry(),
    material = new THREE.MeshStandardMaterial({
      map: texture,
      normalMap: normal,
    }),
    alternate = new THREE.MeshBasicMaterial();
  const counts = new Map();
  for (const o of [texture, normal, geometry, material, alternate])
    o.addEventListener('dispose', () =>
      counts.set(o, (counts.get(o) || 0) + 1),
    );
  const root = new THREE.Group();
  root.add(
    new THREE.Mesh(geometry, material),
    new THREE.Mesh(geometry, material),
  );
  resources.object(root);
  resources.material(alternate);
  root.children[0].material = alternate;
  resources.dispose();
  resources.dispose();
  for (const o of [texture, normal, geometry, material, alternate])
    assert.equal(counts.get(o), 1);
  const late = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshBasicMaterial(),
  );
  let disposed = 0;
  late.geometry.addEventListener('dispose', () => disposed++);
  resources.object(late);
  assert.equal(disposed, 1);
});
test('render batching preserves editable source nodes, ray picking, hidden layers and export geometry', () => {
  const scene = new THREE.Scene(),
    root = new THREE.Group(),
    material = new THREE.MeshStandardMaterial();
  scene.add(root);
  const a = new THREE.Mesh(new THREE.BoxGeometry(), material),
    b = new THREE.Mesh(new THREE.BoxGeometry(), material);
  b.position.x = 2;
  root.add(a, b);
  const geometry = a.geometry,
    batches = createRenderBatches(scene, root);
  batches.setActive(true);
  assert.equal(batches.count, 1);
  assert.equal(root.children.length, 2);
  assert.equal(a.geometry, geometry);
  assert.equal(a.layers.isEnabled(0), false);
  assert.equal(a.layers.isEnabled(1), true);
  const ray = new THREE.Raycaster(
    new THREE.Vector3(0, 0, 4),
    new THREE.Vector3(0, 0, -1),
  );
  ray.layers.set(1);
  assert.ok(ray.intersectObject(root, true).length);
  batches.setActive(false);
  assert.ok(a.layers.isEnabled(0));
  b.visible = false;
  batches.invalidate();
  batches.setActive(true);
  assert.equal(batches.count, 0);
  assert.equal(b.visible, false);
  batches.dispose();
  assert.equal(scene.children.length, 1);
  assert.ok(a.layers.isEnabled(0));
  new ThreeResources().object(root);
  a.geometry.dispose();
  b.geometry.dispose();
  material.dispose();
});
test('stale snapshots cannot overwrite newer commands or rewind the room clock', () => {
  const s = (revision, now) => ({ state: { revision }, now });
  assert.equal(acceptsSnapshot(s(4, 200), s(3, 300)), false);
  assert.equal(acceptsSnapshot(s(4, 200), s(4, 100)), false);
  assert.equal(acceptsSnapshot(s(4, 200), s(5, 199)), true);
});
test('failed group commands are atomic; switching to wander starts at the current pose', () => {
  let s = initialState(10000);
  const original = structuredClone(s);
  assert.throws(() =>
    command(
      s,
      'start_activity',
      { name: 'talk', people: ['context_person-001', 'invalid'], x: 1, z: 26 },
      10000,
    ),
  );
  assert.deepEqual(s, original);
  const id = 'context_person-001',
    before = motionPose(s.people[id], 12000).position;
  s = command(
    s,
    'set_person_activity',
    { person_id: id, activity: 'wander' },
    12000,
  );
  assert.deepEqual(motionPose(s.people[id], 12000).position, before);
});
test('motion retains arrival direction and the environment hour always wraps positively', () => {
  const m = {
    path: [
      [0, 0, 0],
      [10, 0, 0],
      [10, 0, 0],
    ],
    started: 0,
    speed: 1,
    loop: false,
    yaw: 0,
    activity: 'idle',
  };
  assert.equal(motionPose(m, 20000).yaw, Math.PI / 2);
  const s = initialState(100000);
  s.environment.hour = 0;
  assert.ok(hourAt(s, 0) >= 0);
});
test('navigation rejects sub-cell connectors through a wall', () => {
  const nav = new CampusPaths([
    new THREE.Box3(
      new THREE.Vector3(-0.1, 0, -3),
      new THREE.Vector3(0.1, 2, 3),
    ),
  ]);
  assert.equal(
    nav.clearLine(new THREE.Vector3(-2, 0, 0), new THREE.Vector3(2, 0, 0)),
    false,
  );
  assert.equal(
    nav.clearLine(new THREE.Vector3(-3, 0, 0), new THREE.Vector3(-3, 0, 2)),
    true,
  );
});
test('large asset handler honors ranges, validators, HEAD and method restrictions', async () => {
  const asset = { key: 'hash/model', type: 'model/gltf-binary' },
    data = new TextEncoder().encode('0123456789');
  let reads = 0;
  const bucket = {
    head: async () => ({ size: 10, httpEtag: '"abc"' }),
    get: async (_, options) => {
      reads++;
      return {
        body: options?.range
          ? data.slice(
              options.range.offset,
              options.range.offset + options.range.length,
            )
          : data,
      };
    },
  };
  const req = (method = 'GET', headers = {}) =>
    serveDownload(
      new Request('https://example.com/model', { method, headers }),
      bucket,
      asset,
    );
  let r = await req('GET', { Range: 'bytes=2-4' });
  assert.equal(r.status, 206);
  assert.equal(await r.text(), '234');
  assert.equal(r.headers.get('Content-Range'), 'bytes 2-4/10');
  r = await req('GET', { Range: 'bytes=-3' });
  assert.equal(await r.text(), '789');
  assert.equal((await req('GET', { Range: 'bytes=10-' })).status, 416);
  assert.equal((await req('GET', { 'If-None-Match': 'W/"abc"' })).status, 304);
  const count = reads;
  assert.equal((await req('HEAD')).status, 200);
  assert.equal(reads, count);
  assert.equal((await req('POST')).status, 405);
  r = await req('GET', { Range: 'bytes=2-4', 'If-Range': '"old"' });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '0123456789');
});

test('copied assembly layouts retain nested component transforms and reject bad child paths atomically', () => {
  const root = new THREE.Group(),
    child = new THREE.Group();
  root.add(child);
  child.position.set(2, 3, 4);
  const saved = nestedTransforms(root);
  child.position.set(8, 8, 8);
  applyNestedTransforms(root, saved);
  assert.deepEqual(child.position.toArray(), [2, 3, 4]);
  const invalid = [
    { ...saved[0], position: [1, 1, 1] },
    { ...saved[0], path: [999] },
  ];
  assert.throws(() => applyNestedTransforms(root, invalid));
  assert.deepEqual(child.position.toArray(), [2, 3, 4]);
});

test('editing one part preserves unrelated batches and restores the part on deselect', () => {
  const scene = new THREE.Scene(),
    root = new THREE.Group(),
    mat = new THREE.MeshStandardMaterial(),
    geo = new THREE.BoxGeometry();
  scene.add(root);
  const parts = Array.from({ length: 4 }, (_, i) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.x = i;
    root.add(m);
    return m;
  });
  const batches = createRenderBatches(scene, root);
  batches.setActive(true);
  batches.setExcluded(parts[0]);
  batches.setActive(true);
  assert.equal(batches.active, true);
  assert.equal(parts[0].layers.isEnabled(0), true);
  assert.equal(parts[1].layers.isEnabled(0), false);
  parts[0].position.x = 6;
  batches.setExcluded(null);
  batches.setActive(true);
  assert.equal(parts[0].layers.isEnabled(0), false);
  batches.dispose();
  assert.equal(parts[1].layers.isEnabled(0), true);
  geo.dispose();
  mat.dispose();
});
