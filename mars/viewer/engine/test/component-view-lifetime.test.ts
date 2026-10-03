import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { build } from 'esbuild';
import { ComponentViews } from '../../app/engine-view/components.ts';
import { FixtureViews } from '../../app/engine-view/fixtures.ts';
import { PaintOverlay } from '../../app/engine-view/paint.ts';
import { component } from '../world/factory.ts';

function mesh(views: ComponentViews, id: string) {
  const obj = views.group.children.find((child) => child.name === id);
  assert.ok(obj instanceof THREE.Mesh);
  return obj;
}

test('world Reset releases transient component geometry and rebuilds fresh geometry over repeated lifetimes', () => {
  const initial = { entities: { beam: component('beam', '2x4-6ft', [0, 0, 0]) } };
  const expanded = { entities: { ...initial.entities, panel: component('panel', 'plywood-4x8', [4, 0, 0]) } };
  const source = JSON.stringify({ initial, expanded });
  const views = new ComponentViews();
  const released = new Set<THREE.BufferGeometry>();
  const disposals = new Map<THREE.BufferGeometry, number>();
  const watch = (geometry: THREE.BufferGeometry) => {
    if (disposals.has(geometry)) return;
    disposals.set(geometry, 0);
    geometry.addEventListener('dispose', () => disposals.set(geometry, disposals.get(geometry)! + 1));
  };
  try {
    views.reset(initial);
    for (let cycle = 0; cycle < 3; cycle++) {
      const beam = mesh(views, 'beam');
      watch(beam.geometry);
      views.onTick(expanded);
      const panel = mesh(views, 'panel');
      watch(panel.geometry);
      assert.ok(!released.has(beam.geometry));
      assert.ok(!released.has(panel.geometry), 'a later world must not reuse disposed transient geometry');
      const material = beam.material;
      views.onTick(expanded);
      assert.equal(mesh(views, 'panel').geometry, panel.geometry, 'ordinary ticks retain geometry sharing');
      assert.equal(disposals.get(panel.geometry), 0);
      views.reset(initial);
      assert.equal(disposals.get(beam.geometry), 1);
      assert.equal(disposals.get(panel.geometry), 1, 'Reset releases the panel absent from the initial world');
      released.add(beam.geometry);
      released.add(panel.geometry);
      assert.equal(views.group.children.length, 1);
      assert.notEqual(mesh(views, 'beam').geometry, beam.geometry);
      assert.equal(mesh(views, 'beam').material, material, 'Reset preserves the existing material pool');
    }
    const final = mesh(views, 'beam').geometry;
    watch(final);
    views.dispose();
    assert.equal(views.group.children.length, 0);
    assert.equal(disposals.get(final), 1, 'full view disposal releases the last world');
    for (const geometry of released) assert.equal(disposals.get(geometry), 1, 'old cache entries are not disposed twice');
    assert.equal(JSON.stringify({ initial, expanded }), source, 'renderer lifetimes never alter authoritative entities');
  } finally {
    views.dispose();
  }
});

test('paint image leases share aliases, survive band updates and release on clearing and repeated world Reset', t => {
  const loads: { path: string; image: THREE.Texture; disposed: number; finish(): void }[] = [];
  t.mock.method(THREE.TextureLoader.prototype, 'load', (path: string, onLoad?: (image: THREE.Texture) => void) => {
    const image = new THREE.Texture();
    const load = { path, image, disposed: 0, finish() { image.image = { width: 2, height: 2 }; onLoad?.(image); } };
    image.addEventListener('dispose', () => load.disposed++);
    loads.push(load);
    return image;
  });
  const sheet = component('sheet', 'plywood-4x8', [0, 1.2192, 0], 0, {
    pose: { p: [0, 1.2192, 0], yaw: 0, roll: Math.PI / 2 },
    paint: { face: 'front', texture: 'flower-mural-2024', coverage: 1, bands: [{ from: 0.5, to: 1, coverage: 1 }] },
  });
  const alias = structuredClone(sheet);
  alias.paint!.texture = 'flower-mural';
  const a = new PaintOverlay(new THREE.Group()), b = new PaintOverlay(new THREE.Group());
  const views = new ComponentViews();
  try {
    a.update(sheet);
    b.update(alias);
    assert.equal(loads.length, 1, 'canonical aliases share one image');
    const shared = loads[0];
    sheet.paint!.bands[0].coverage = 0.7;
    sheet.pose.p[2] = 1;
    a.update(sheet);
    assert.equal(loads.length, 1, 'ordinary paint progress and pose updates retain the lease');
    a.dispose();
    assert.equal(shared.disposed, 0, 'one remaining overlay keeps the shared image alive');
    delete alias.paint;
    b.update(alias);
    assert.equal(shared.disposed, 1, 'clearing the last paint user releases its image');
    b.dispose();
    const unpainted = structuredClone(sheet);
    delete unpainted.paint;
    const initial = { entities: { sheet: unpainted } };
    const painted = { entities: { sheet } };
    const source = JSON.stringify({ initial, painted });
    views.reset(initial);
    for (let cycle = 0; cycle < 3; cycle++) {
      views.onTick(painted);
      assert.equal(loads.length, cycle + 2, 'a fresh world acquires a fresh image');
      const load = loads.at(-1)!;
      assert.notEqual(load.image, shared.image);
      if (cycle === 0) {
        shared.finish();
        assert.equal(shared.disposed, 1, 'late load completion does not double-dispose');
        assert.equal(shared.image.image, null, 'a late image cannot revive a released texture');
        b.update(sheet);
        assert.equal(loads.length, 2, 'old completion cannot replace the fresh shared cache entry');
        b.dispose();
        assert.equal(load.disposed, 0, 'the new world retains its own lease');
      }
      load.finish();
      views.onTick(painted);
      assert.equal(load.disposed, 0);
      views.reset(initial);
      assert.equal(load.disposed, 1, 'Reset releases the old painted world texture');
    }
    views.dispose();
    assert.ok(loads.every(load => load.disposed === 1));
    assert.equal(JSON.stringify({ initial, painted }), source);
  } finally {
    a.dispose(); b.dispose(); views.dispose();
  }
});

test('year backdrop disposal releases shared mesh and line resources once across repeated lifetimes', async () => {
  // Bundle the actual browser module's extensionless imports without changing them.
  // External Three imports share the same classes as this native test; no WebGL is created.
  const bundle = await build({
    entryPoints: [new URL('../../app/lab/year-walkabout-view.ts', import.meta.url).pathname],
    bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{ name: 'native-three', setup(builder) {
      builder.onResolve({ filter: /^three(?:\/|$)/ }, args => ({ path: import.meta.resolve(args.path), external: true }));
    } }],
  });
  const { disposeTree } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  for (let cycle = 0; cycle < 3; cycle++) {
    const root = new THREE.Group();
    const meshGeometry = new THREE.BoxGeometry();
    const lineGeometry = new THREE.EdgesGeometry(meshGeometry);
    const texture = new THREE.Texture();
    const meshMaterial = new THREE.MeshBasicMaterial({ map: texture });
    const lineMaterial = new THREE.LineBasicMaterial();
    const nested = new THREE.Group();
    root.add(new THREE.Mesh(meshGeometry, meshMaterial), nested);
    nested.add(new THREE.LineSegments(lineGeometry, lineMaterial), new THREE.LineSegments(lineGeometry, lineMaterial));
    const resources = [meshGeometry, lineGeometry, texture, meshMaterial, lineMaterial];
    const counts = resources.map(resource => {
      const count = { value: 0 };
      resource.addEventListener('dispose', () => count.value++);
      return count;
    });
    disposeTree(root);
    assert.deepEqual(counts.map(count => count.value), [1, 1, 1, 1, 1], 'old line/mesh resources are released once despite shared drawables');
  }
});

test('campfire Reset releases each old stone/log geometry without disposing shared fixture geometry', () => {
  const fire = component('fire', 'campfire', [0, 0, 0], 0, { kind: 'fixture' });
  const bench = component('bench', 'bench-6ft', [4, 0, 0], 0, { kind: 'fixture' });
  const world = { entities: { fire, bench } };
  const source = JSON.stringify(world);
  const views = new FixtureViews();
  const previous = new Set<THREE.BufferGeometry>();
  const disposals = new Map<THREE.BufferGeometry, number>();
  const fireGeometry = () => {
    const geometries = new Set<THREE.BufferGeometry>();
    views.group.children.find(child => child.name === 'fire')!.traverse(obj => {
      if (obj instanceof THREE.Mesh && ['DodecahedronGeometry', 'CylinderGeometry'].includes(obj.geometry.type)) geometries.add(obj.geometry);
    });
    assert.equal(geometries.size, 2);
    return geometries;
  };
  try {
    views.reset(world);
    const unit = (views.group.children.find(child => child.name === 'bench')!.children[0] as THREE.Mesh).geometry;
    let unitDisposals = 0;
    unit.addEventListener('dispose', () => unitDisposals++);
    for (let cycle = 0; cycle < 3; cycle++) {
      const old = fireGeometry();
      for (const geometry of old) {
        assert.ok(!previous.has(geometry));
        disposals.set(geometry, 0);
        geometry.addEventListener('dispose', () => disposals.set(geometry, disposals.get(geometry)! + 1));
      }
      views.onTick(world);
      assert.deepEqual(fireGeometry(), old, 'ordinary ticks reuse the fire geometry');
      views.reset(world);
      for (const geometry of old) {
        assert.equal(disposals.get(geometry), 1, 'Reset releases the old fire geometry');
        previous.add(geometry);
      }
      assert.equal(unitDisposals, 0, 'shared fixture geometry survives Reset');
    }
    views.dispose();
    assert.equal(unitDisposals, 1);
    for (const geometry of previous) assert.equal(disposals.get(geometry), 1, 'full disposal does not retain old fire geometry');
    assert.equal(JSON.stringify(world), source);
  } finally {
    views.dispose();
  }
});

test('cutting station blade geometry is released on Reset, removal and full view disposal', () => {
  const cutting = component('cutting', 'cutting-station', [0, 0, 0], 0, { kind: 'fixture' });
  const bench = component('bench', 'bench-6ft', [4, 0, 0], 0, { kind: 'fixture' });
  const world = { entities: { cutting, bench } };
  const source = JSON.stringify(world);
  const views = new FixtureViews();
  const disposals = new Map<THREE.BufferGeometry, number>();
  const blade = () => {
    const cuttingView = views.group.children.find(child => child.name === 'cutting')!;
    const mesh = cuttingView.children.find(obj => obj instanceof THREE.Mesh && obj.geometry.type === 'CylinderGeometry');
    assert.ok(mesh instanceof THREE.Mesh);
    return mesh;
  };
  const watch = () => {
    const geometry = blade().geometry;
    assert.ok(!disposals.has(geometry), 'rebuilt saws never retain old blade geometry');
    disposals.set(geometry, 0);
    geometry.addEventListener('dispose', () => disposals.set(geometry, disposals.get(geometry)! + 1));
    return geometry;
  };
  try {
    views.reset(world);
    const material = blade().material;
    const unit = (views.group.children.find(child => child.name === 'bench')!.children[0] as THREE.Mesh).geometry;
    let unitDisposals = 0;
    unit.addEventListener('dispose', () => unitDisposals++);
    for (let cycle = 0; cycle < 3; cycle++) {
      const old = watch();
      views.onTick(world);
      assert.equal(blade().geometry, old, 'ordinary ticks retain the blade');
      assert.equal(disposals.get(old), 0);
      views.reset(world);
      assert.equal(disposals.get(old), 1, 'Reset releases the previous blade');
      assert.equal(blade().material, material);
      assert.equal(unitDisposals, 0, 'Reset preserves shared fixture geometry');
    }
    const removed = watch();
    views.onTick({ entities: { bench } });
    assert.equal(disposals.get(removed), 1, 'entity removal releases its blade');
    assert.equal(views.group.children.length, 1);
    views.onTick(world);
    const final = watch();
    views.dispose();
    assert.equal(disposals.get(final), 1, 'full exit releases the rebuilt blade');
    assert.equal(unitDisposals, 1);
    for (const count of disposals.values()) assert.equal(count, 1, 'old blades are not retained for duplicate disposal');
    assert.equal(JSON.stringify(world), source, 'renderer cleanup never changes authored entities');
  } finally {
    views.dispose();
  }
});
