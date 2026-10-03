// PILE-01: aggregate inventory and the extracted component share material identity.
// No new historical colours, physical actions or baseline images are introduced.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { FixtureViews } from '../app/engine-view/fixtures.ts';
import { ComponentViews } from '../app/engine-view/components.ts';
import { BUNDLES } from '../engine/world/catalog-stock.ts';
import { bundleEntity, bundleContents, lyingPose, takeFromBundle } from '../engine/construction/bundle.ts';
import { def } from '../engine/world/catalog.ts';
import type { Entity, Provenance } from '../engine/world/types.ts';
import { openLab, labFrames } from './lab-helpers';
import { captureView, writeArtifact } from './helpers';
import { addAll, emptyWorld, human } from '../engine/world/factory.ts';
import { Runtime } from '../engine/runtime/runtime.ts';
import { Spatial } from '../engine/spatial/service.ts';
import type { SpatialScene } from '../engine/spatial/types.ts';

const provenance: Provenance = { origin: 'design-edit', confidence: 'hypothetical', note: 'renderer regression' };
test('invalid extraction refuses reused identity, missing stock and foreign ownership without consuming stock', () => {
  const ground: SpatialScene = { bounds: [-20, -20, 20, 20], levels: [{ id: 0, y: 0, label: 'ground' }], surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [20, 20], yaw: 0 } }], obstacles: [], links: [] };
  const world = addAll(emptyWorld('test', ground), bundleEntity('pile', 'stack-upright-16ft-kit', 0, 0, 0, 2, 0, provenance), human('p1', -3, -3), human('p2', -2, -3));
  const rt = new Runtime(world, new Map([['take_from_bundle', takeFromBundle]]), { spatial: new Spatial(ground) });
  const params = { crew: ['p1', 'p2'], bundle: 'pile', piece: 'new-frame', to: { x: 0, z: 2, yaw: 0 } };
  expect(rt.submit('take_from_bundle', { ...params, piece: 'pile' }).diagnostic?.code).toBe('bundle.piece-exists');
  expect(rt.submit('take_from_bundle', { ...params, bundle: 'missing' }).diagnostic?.code).toBe('bundle.unknown');
  const held: Entity = { id: 'foreign-frame', def: 'upright-16ft-kit', kind: 'component', pose: lyingPose('upright-16ft-kit', 10, 10, 0, 0), provenance, phase: 'carried', support: { kind: 'held', by: ['p1', 'p2'] } };
  world.entities[held.id] = held;
  world.entities.p1.human!.grip = { entity: held.id, slot: 'carry' };
  world.entities.p2.human!.grip = { entity: held.id, slot: 'carry' };
  expect(rt.submit('take_from_bundle', params).diagnostic?.code).toBe('actor.holding');
  expect(world.entities.pile.contents).toEqual(bundleContents('stack-upright-16ft-kit', 2));
  expect(world.entities['new-frame']).toBeUndefined();
  const fixtures = new FixtureViews(), components = new ComponentViews();
  const before = JSON.stringify(world);
  fixtures.onTick(world); components.onTick(world); components.render(1);
  expect(JSON.stringify(world)).toBe(before);
  expect(fixtures.stacks()[0].count).toBe(2);
  expect(components.group.children.map(o => o.name)).toEqual(['foreign-frame']);
  fixtures.dispose(); components.dispose();
});
function colors(obj: THREE.Object3D) {
  const result = new Set<string>();
  obj.traverse(o => { if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) result.add(o.material.color.getHexString()); });
  return [...result];
}

test('pile stock matches component palette, consumes one visible piece and preserves entity through phases', () => {
  for (const bundleDef of Object.keys(BUNDLES).filter(id => id.startsWith('stack-upright-') || id.startsWith('stack-beam-'))) {
    const fixtures = new FixtureViews(), components = new ComponentViews();
    const pile = bundleEntity('pile', bundleDef, 0, 0, 0, 2, 0, provenance);
    const pieceDef = BUNDLES[bundleDef].piece;
    const piece: Entity = { id: 'piece', def: pieceDef, kind: 'component', pose: lyingPose(pieceDef, 0, 3, 0, 0), provenance, phase: 'stored', support: { kind: 'ground' } };
    const before = { entities: { pile } };
    const original = JSON.stringify(before);
    fixtures.onTick(before);
    expect(fixtures.stacks()[0].count).toBe(2);
    expect(JSON.stringify(before)).toBe(original);
    components.onTick({ entities: { piece } }); components.render(1);
    const material = colors(components.group.children[0]);
    expect(material).toHaveLength(1);
    expect(colors(fixtures.group.children[0])).toContain(material[0]);
    pile.contents = bundleContents(bundleDef, 1);
    const after = { entities: { pile, piece } };
    fixtures.onTick(after); components.onTick(after); components.render(1);
    const obj = components.group.children[0];
    expect(fixtures.stacks()[0].count).toBe(1);
    expect(components.group.children.map(o => o.name)).toEqual(['piece']);
    for (const phase of ['carried', 'raising', 'installed'] as const) {
      piece.phase = phase;
      piece.support = phase === 'installed' ? { kind: 'connected', to: ['other-frame'] } : { kind: 'held', by: ['p1', 'p2'] };
      piece.pose.p[1] += 0.1;
      const state = JSON.stringify(after);
      components.onTick(after); components.render(1);
      expect(components.group.children[0]).toBe(obj);
      expect(colors(obj)).toEqual(material);
      expect(JSON.stringify(after)).toBe(state); // renderer cannot invent support/ownership
    }
    fixtures.onTick({ entities: { piece } });
    expect(fixtures.stacks()).toEqual([]);
    expect(fixtures.group.children).toHaveLength(0);
    components.onTick({ entities: {} });
    expect(components.group.children).toHaveLength(0);
    fixtures.dispose(); components.dispose();
    expect(def(pieceDef).color).toBeDefined();
  }
});

test('explicit supported pre-W51 historical source extracts its first frame from counted stock before carrying it', async ({ page }, testInfo) => {
  const sourceCommit = 'a0c347e0374b473876c97f536dc44dba42399521';
  const body = execFileSync('git', ['show', `${sourceCommit}:viewer/public/engine/campus-2022.json`], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const sourceSha256 = createHash('sha256').update(body).digest('hex');
  expect(sourceSha256).toBe('205d20234f72a5a05da8252262b9b57488080c70727c20a00b6daf08162d6d93');
  await page.route('**/engine/campus-2022.json', route => route.fulfill({ contentType: 'application/json', body }));
  await openLab(page, 'year-build-2022');
  await page.evaluate(() => window.__marsEngine!.pause(true));
  const initial = await page.evaluate(() => {
    const h = window.__marsEngine! as typeof window.__marsEngine & { yearBuild(): { steps: { id: string; verb: string; item: string | null }[]; piles: { id: string; def: string; p: number[]; count: number | null }[] }; stacks(): { id: string; count: number }[] };
    return { build: h!.yearBuild(), components: h!.components(), stacks: h!.stacks() };
  });
  const take = initial.build.steps.find(s => s.verb === 'take_from_bundle')!;
  const carry = initial.build.steps.find(s => s.verb === 'carry')!;
  const pile = initial.build.piles.find(p => p.def.startsWith('stack-upright'))!;
  expect(initial.components.some(c => c.id === carry.item)).toBe(false);
  await page.evaluate(p => window.__marsEngine!.camera([p[0] + 7, p[1] + 6, p[2] + 9], [p[0], p[1], p[2]]), pile.p);
  await labFrames(page);
  await captureView(page, 'pile-continuity-before', { compare: false, testInfo });
  const extraction = await page.evaluate(id => window.__marsEngine!.runUntilSteps([id], 'completed', 6000), take.id);
  expect(extraction.reached).toBe(true);
  await labFrames(page);
  const after = await page.evaluate(() => {
    const h = window.__marsEngine! as typeof window.__marsEngine & { stacks(): { id: string; count: number }[] };
    return { components: h!.components(), stacks: h!.stacks(), violations: h!.violations() };
  });
  const frame = after.components.find(c => c.id === carry.item)!;
  expect(frame.def).toBe(BUNDLES[pile.def].piece);
  expect(frame.phase).toBe('stored'); expect(frame.support).toBe('ground');
  expect(after.components.filter(c => c.id === carry.item)).toHaveLength(1);
  expect(after.stacks.find(p => p.id === pile.id)!.count).toBe(pile.count! - 1);
  expect(frame.rendered).not.toBeNull();
  expect(after.violations).toEqual([]);
  await captureView(page, 'pile-continuity-extracted', { compare: false, testInfo });
  const carried = await page.evaluate(id => {
    const h = window.__marsEngine!;
    for (let i = 0; i < 6000; i++) {
      const c = h.components().find(c => c.id === id);
      if (c?.phase === 'carried') return c;
      h.step(1);
    }
    return null;
  }, carry.item!);
  expect(carried?.id).toBe(carry.item);
  expect(carried?.support).toBe('held');
  await page.evaluate(() => window.__marsEngine!.step(30)); // show the physical lift, beyond its first tick
  await labFrames(page);
  await captureView(page, 'pile-continuity-carried', { compare: false, testInfo });
  writeArtifact('pile-continuity.json', { sourceCommit, sourceSha256, scope: 'Explicit supported historical source; current reconciled 2022 house is refused before build.', initial, after, carried });
});

// The supported build-bay uses individual stored components, not counted bundle
// fixtures. Exercise its actual identity/support handoff without calling it unbundling.
test('supported build-bay keeps the same stock frame through carry and connected installation', async ({ page }, testInfo) => {
  await openLab(page, 'build-bay');
  await page.evaluate(() => window.__marsEngine!.pause(true));
  const initial = await page.evaluate(() => window.__marsEngine!.components().find(c => c.id === 'A')!);
  expect(initial.phase).toBe('stored'); expect(initial.support).toBe('ground');
  await page.evaluate(p => window.__marsEngine!.camera([p[0] + 9, p[1] + 6, p[2] + 10], p), initial.pose.p);
  await labFrames(page);
  await captureView(page, 'pile-continuity-build-bay-stock', { compare: false, testInfo });
  const held = await page.evaluate(() => {
    const h = window.__marsEngine!;
    for (let i = 0; i < 3000; i++) {
      const c = h.components().find(c => c.id === 'A')!;
      if (c.phase === 'carried') return c;
      h.step(1);
    }
    return null;
  });
  expect(held?.def).toBe(initial.def); expect(held?.support).toBe('held');
  const released = await page.evaluate(() => window.__marsEngine!.runUntilSteps(['releaseA'], 'completed', 10000));
  expect(released.reached).toBe(true);
  await labFrames(page);
  const installed = await page.evaluate(() => ({ component: window.__marsEngine!.components().find(c => c.id === 'A')!, duplicates: window.__marsEngine!.components().filter(c => c.id === 'A').length, violations: window.__marsEngine!.violations() }));
  expect(installed.component.def).toBe(initial.def);
  expect(installed.component.phase).toBe('installed'); expect(installed.component.support).toBe('connected');
  expect(installed.duplicates).toBe(1); expect(installed.violations).toEqual([]);
  await page.evaluate(p => window.__marsEngine!.camera([p[0] + 8, p[1] + 5, p[2] + 9], [p[0], p[1] + 1.5, p[2]]), installed.component.pose.p);
  await labFrames(page);
  await captureView(page, 'pile-continuity-build-bay-installed', { compare: false, testInfo });
  writeArtifact('pile-continuity-build-bay.json', { initial, held, installed });
});
