/// <reference types="node" />
import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
import type { readSeedPlanting } from '../engine/activities/seed-planting.ts';
import type { readSeedbed } from '../engine/objects/planting.ts';
import type { Entity } from '../engine/world/types.ts';
declare global {
  interface Window {
    __marsEngine: EngineHook;
  }
}
type PlantingHook = EngineHook & {
  seedPlanting: () => {
    action: ReturnType<typeof readSeedPlanting> | null;
    beds: ReturnType<typeof readSeedbed>[];
    source: Entity | undefined;
  };
  seedMarkers: () => {
    plant: string;
    deposits: number;
    count: number;
    positions: number[][];
    decorativePlantVisible: boolean;
  }[];
};
const source = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
  directory = path.resolve(
    'e2e/artifacts',
    process.env.E2E_RUN ?? 'seed-planting',
  );
const errors = new WeakMap<Page, string[]>();
const button = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true });
async function inspect(page: Page) {
  return page.evaluate(() => {
    const h = window.__marsEngine as PlantingHook;
    return {
      state: h.state(),
      planting: h.seedPlanting(),
      markers: h.seedMarkers(),
      records: h.records(),
      violations: h.violations(),
      components: h.components(),
      fixtures: h.fixtures(),
      entities: h.cameraEntities(),
      slots: h.slots(),
      held: h.heldItems(),
      hands: h.humanFields(),
      bones: h.bones(),
      activity: h.cameraActivityReadout(),
      attention: h.activityAttentionTargets(),
    };
  });
}
type Evidence = Awaited<ReturnType<typeof inspect>>;
function bed(s: Evidence, id: string) {
  const b = s.planting.beds.find((b) => 'plant' in b && b.plant === id);
  if (!b || 'code' in b) throw Error(`Missing actual seedbed ${id}`);
  return b;
}
function save(name: string, data: unknown) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, `${name}.json`),
    JSON.stringify({ source, run: process.env.E2E_RUN, data }, null, 2),
  );
}
async function freeze(page: Page) {
  if (!(await page.evaluate(() => window.__marsEngine.state().paused)))
    await button(page, 'Pause').click();
}
async function play(page: Page) {
  if (await page.evaluate(() => window.__marsEngine.state().paused))
    await button(page, 'Play').click();
}
async function capture(page: Page, name: string, verify = true) {
  await freeze(page);
  const s = await inspect(page);
  if (verify) expect(s.violations).toEqual([]);
  await page.screenshot({ path: path.join(directory, `${name}.png`) });
  writeFileSync(
    path.join(directory, `${name}.a11y.yml`),
    await page.locator('body').ariaSnapshot(),
  );
  save(name, s);
  return s;
}
async function reset(page: Page) {
  await button(page, 'Reset').click();
  expect(await page.evaluate(() => window.__marsEngine.records())).toEqual([]);
  await button(page, 'Step').click(); // Fresh tick1 readiness only; planting uses actual Play.
  const s = await inspect(page);
  expect(s.state.tick).toBe(1);
  expect(s.planting.action).toBeNull();
  expect(s.violations).toEqual([]);
  expect(s.planting.source?.contents).toMatchObject({
    food: 'seeds',
    fraction: 0.5,
  });
  for (const id of ['planter-a', 'planter-b'])
    expect(bed(s, id)).toMatchObject({
      deposited: 0,
      deposits: 0,
      completed: false,
    });
  markers(s);
  conservation(s);
  for (const m of s.markers) {
    expect(m.count).toBe(0);
    expect(m.positions).toEqual([]);
    expect(m.decorativePlantVisible).toBe(false);
  }
}
async function open(page: Page, scenario: string) {
  mkdirSync(directory, { recursive: true });
  const log: string[] = [];
  errors.set(page, log);
  page.on('pageerror', (e) => log.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error') log.push(e.text());
  });
  await page.goto(`/lab?scenario=${scenario}`);
  await page.waitForFunction(() => window.__marsEngine?.ready);
  await page.evaluate(
    (name) => window.__marsEngine.runScenario(name, { paused: true, speed: 2 }),
    scenario,
  );
  await reset(page);
  await expect(page.getByTestId('seed-planting-hud')).toContainText(
    'Hypothetical seeds',
  );
  const s = await inspect(page);
  await page.evaluate(
    (target) =>
      window.__marsEngine.camera(
        [target[0] + 2.8, target[1] + 2.3, target[2] - 4],
        target,
      ),
    bed(s, 'planter-a').target,
  );
  return inspect(page);
}
function conservation(s: Evidence) {
  expect(s.planting.source?.contents?.food).toBe('seeds');
  const a = bed(s, 'planter-a'),
    b = bed(s, 'planter-b');
  expect(
    s.planting.source!.contents!.fraction + a.deposited + b.deposited,
  ).toBe(0.5);
  for (const p of [a, b]) {
    expect(p.deposited).toBe(p.deposits * 0.0625);
    expect(p.deposits).toBeGreaterThanOrEqual(0);
    expect(p.deposits).toBeLessThanOrEqual(4);
    expect(p.support).toEqual({ kind: 'ground' });
  }
}
function markers(s: Evidence) {
  expect(s.markers.map((m) => m.plant).sort()).toEqual([
    'planter-a',
    'planter-b',
  ]);
  for (const m of s.markers) {
    const p = bed(s, m.plant);
    expect(m.count).toBe(p.deposits);
    expect(m.deposits).toBe(p.deposits);
    expect(m.positions).toHaveLength(p.deposits);
    expect(m.decorativePlantVisible).toBe(false);
    const centers = [
      [-0.12, -0.12],
      [0.12, -0.12],
      [-0.12, 0.12],
      [0.12, 0.12],
    ];
    const c = Math.cos(p.pose.yaw),
      sin = Math.sin(p.pose.yaw);
    for (const [i, point] of m.positions.entries()) {
      expect(point).toHaveLength(3);
      expect(point.every(Number.isFinite)).toBe(true);
      const [x, z] = centers[i];
      // Actual visible mesh centers transformed through the fixture, including 90° setup.
      expect(point[0]).toBeCloseTo(p.pose.p[0] + x * c - z * sin, 9);
      expect(point[1]).toBeCloseTo(p.pose.p[1] + 0.8, 9);
      expect(point[2]).toBeCloseTo(p.pose.p[2] + x * sin + z * c, 9);
      const dx = point[0] - p.pose.p[0],
        dz = point[2] - p.pose.p[2];
      const localX = dx * c + dz * sin,
        localZ = -dx * sin + dz * c;
      // Renderer marker width/depth, inside the actual 0.5 × 0.5 soil surface.
      expect(Math.abs(localX) + 0.075 / 2).toBeLessThanOrEqual(0.25);
      expect(Math.abs(localZ) + 0.035 / 2).toBeLessThanOrEqual(0.25);
    }
  }
}
function sameFixtures(s: Evidence, initial: Evidence) {
  expect(s.fixtures).toEqual(initial.fixtures);
  expect(s.entities.map((e) => e.id).sort()).toEqual(
    initial.entities.map((e) => e.id).sort(),
  );
  expect(s.components.map((c) => [c.id, c.def])).toEqual(
    initial.components.map((c) => [c.id, c.def]),
  );
}
function returned(s: Evidence, initial: Evidence) {
  expect(s.planting.source?.id).toBe('seed-bowl');
  expect(s.planting.source?.pose).toEqual(initial.planting.source?.pose);
  expect(s.planting.source?.support).toEqual(initial.planting.source?.support);
  expect(s.planting.source?.support).toMatchObject({
    kind: 'resting-on',
    on: 'seed-table',
    slot: 'r0c2',
  });
}
function reaching(s: Evidence) {
  expect(s.planting.action?.phase).toBe('sowing');
  expect(s.planting.source?.support).toMatchObject({
    kind: 'in-hand',
    by: 'planter',
    hand: 'right',
  });
  expect(s.held.some((q) => q.id === 'seed-bowl' && q.by === 'planter')).toBe(
    true,
  );
  expect(s.planting.action?.hand).toHaveLength(3);
  expect(s.planting.action?.hand?.every(Number.isFinite)).toBe(true);
  expect(s.hands.planter.hands?.right).toEqual(s.planting.action?.hand);
  expect(s.bones.planter.activity).toBe('reach');
  expect(Math.abs(Math.min(...s.bones.planter.soles))).toBeLessThanOrEqual(
    0.03,
  );
  expect(s.state.humans.find((h) => h.id === 'planter')?.p[1]).toBe(0);
}
function clean(s: Evidence) {
  expect(s.violations).toEqual([]);
  expect(s.held).toEqual([]);
  expect(s.slots.filter((v) => v.claimedBy !== null)).toEqual([]);
  expect(s.state.humans.filter((h) => h.task !== null)).toEqual([]);
  expect(Object.values(s.hands).filter((h) => h.hands !== null)).toEqual([]);
  expect(
    s.records.filter((r) => !['completed', 'cancelled'].includes(r.status)),
  ).toEqual([]);
}
async function partial(page: Page) {
  await page.waitForFunction(() => {
    const s = (window.__marsEngine as PlantingHook).seedPlanting(),
      b = s.action?.seedbed;
    return (
      s.action?.phase === 'sowing' &&
      !!b &&
      !('code' in b) &&
      b.deposits >= 1 &&
      b.deposits <= 2
    );
  });
}
async function terminal(page: Page, status: 'completed' | 'cancelled') {
  await page.waitForFunction((wanted) => {
    const s = (window.__marsEngine as PlantingHook).seedPlanting();
    return (
      s.action?.status === wanted && s.source?.support?.kind === 'resting-on'
    );
  }, status);
}
test.afterEach(async ({ page }, info) => {
  const name = info.title.startsWith('default')
    ? 'seed-planting-default'
    : 'seed-planting-rotated';
  save(`${name}-result`, {
    status: info.status,
    errors: info.errors.map((e) => e.message),
    pageErrors: errors.get(page) ?? [],
    state: await inspect(page),
  });
  if (info.status !== info.expectedStatus)
    await capture(page, `${name}-failure`, false);
});

test('default actual Play: partial conserved deposits, safe Pause and same-purpose Continue complete both plots without refill', async ({
  page,
}) => {
  const initial = await open(page, 'seed-planting');
  await button(page, 'Start plant A').click();
  await play(page);
  await partial(page);
  const partialA = await capture(
    page,
    'seed-planting-default-actual-partial-markers',
  );
  reaching(partialA);
  conservation(partialA);
  markers(partialA);
  sameFixtures(partialA, initial);
  const original = bed(partialA, 'planter-a');
  await button(page, 'Pause planting').click();
  await play(page);
  await terminal(page, 'cancelled');
  const paused = await capture(
    page,
    'seed-planting-default-safe-return-retained-purpose',
  );
  clean(paused);
  returned(paused, initial);
  conservation(paused);
  markers(paused);
  expect(bed(paused, 'planter-a')).toMatchObject({
    purpose: original.purpose,
    deposited: original.deposited,
    deposits: original.deposits,
    completed: false,
    source: 'seed-bowl',
    actor: 'planter',
  });
  expect(paused.planting.source?.contents?.fraction).toBe(
    partialA.planting.source?.contents?.fraction,
  );
  await expect(button(page, 'Start plant B')).toBeDisabled();
  await expect(
    page.getByTestId('seed-planting-admission-planter-b'),
  ).toContainText('seed_planting.source-committed');
  await button(page, 'Continue plant A').click();
  const admitted = await inspect(page);
  expect(admitted.planting.action?.bindings.resume).toBe(true);
  expect(bed(admitted, 'planter-a').purpose).toBe(original.purpose);
  expect(bed(admitted, 'planter-a').deposited).toBe(original.deposited);
  await play(page);
  await page.waitForFunction((count) => {
    const s = (window.__marsEngine as PlantingHook).seedPlanting(),
      b = s.action?.seedbed;
    return (
      s.action?.phase === 'sowing' &&
      !!b &&
      !('code' in b) &&
      b.deposits > count &&
      b.deposits < 4
    );
  }, original.deposits);
  const continuing = await capture(
    page,
    'seed-planting-default-explicit-continuation',
  );
  reaching(continuing);
  conservation(continuing);
  markers(continuing);
  expect(bed(continuing, 'planter-a').purpose).toBe(original.purpose);
  expect(bed(continuing, 'planter-a').deposits).toBeGreaterThan(
    original.deposits,
  );
  await play(page);
  await terminal(page, 'completed');
  const completedA = await capture(
    page,
    'seed-planting-default-first-plot-returned',
  );
  clean(completedA);
  returned(completedA, initial);
  conservation(completedA);
  markers(completedA);
  expect(bed(completedA, 'planter-a')).toMatchObject({
    deposited: 0.25,
    deposits: 4,
    completed: true,
    purpose: original.purpose,
  });
  expect(completedA.planting.source?.contents?.fraction).toBe(0.25);
  await button(page, 'Start plant B').click();
  await play(page);
  await terminal(page, 'completed');
  await freeze(page);
  await page.evaluate(() => {
    const p = (window.__marsEngine as PlantingHook)
      .seedPlanting()
      .beds.find((b) => 'plant' in b && b.plant === 'planter-b');
    if (p && 'target' in p)
      window.__marsEngine.camera(
        [p.target[0] + 2.8, p.target[1] + 2.3, p.target[2] - 4],
        p.target,
      );
  });
  const completedB = await capture(
    page,
    'seed-planting-default-both-plots-empty-finite-bowl',
  );
  clean(completedB);
  returned(completedB, initial);
  conservation(completedB);
  markers(completedB);
  sameFixtures(completedB, initial);
  expect(bed(completedB, 'planter-a')).toEqual(bed(completedA, 'planter-a'));
  expect(bed(completedB, 'planter-b')).toMatchObject({
    deposited: 0.25,
    deposits: 4,
    completed: true,
  });
  expect(completedB.planting.source?.contents?.fraction).toBe(0);
  expect(bed(completedB, 'planter-b').purpose).not.toBe(original.purpose);
  await expect(button(page, 'Start plant A')).toBeDisabled();
  await expect(button(page, 'Start plant B')).toBeDisabled();
  await reset(page);
  expect(errors.get(page)).toEqual([]);
  save('seed-planting-default-proof', {
    initial,
    partialA,
    paused,
    admitted,
    continuing,
    completedA,
    completedB,
  });
});

test('rotated actual Play: directive safe return, exact retained material, explicit Continue then End partial and complete same purpose', async ({
  page,
}) => {
  const initial = await open(page, 'seed-planting-rotated');
  await button(page, 'Start plant A').click();
  await play(page);
  await partial(page);
  const partialA = await capture(
    page,
    'seed-planting-rotated-actual-soil-markers',
  );
  reaching(partialA);
  conservation(partialA);
  markers(partialA);
  const original = bed(partialA, 'planter-a');
  await button(page, 'Direct planter away').click();
  await play(page);
  await page.waitForFunction(() => {
    const h = window.__marsEngine as PlantingHook,
      s = h.seedPlanting(),
      direction = h
        .records()
        .filter(
          (r) =>
            r.verb === 'walk_to' &&
            !r.parent &&
            (r.params as { actor?: string }).actor === 'planter',
        )
        .at(-1);
    return (
      s.action?.status === 'cancelled' &&
      s.source?.support?.kind === 'resting-on' &&
      direction?.status === 'completed'
    );
  });
  const directed = await capture(
    page,
    'seed-planting-rotated-directed-after-safe-return',
  );
  clean(directed);
  returned(directed, initial);
  conservation(directed);
  markers(directed);
  expect(bed(directed, 'planter-a')).toMatchObject({
    purpose: original.purpose,
    deposited: original.deposited,
    deposits: original.deposits,
  });
  expect(directed.planting.source?.contents?.fraction).toBe(
    partialA.planting.source?.contents?.fraction,
  );
  expect(directed.state.humans.find((h) => h.id === 'planter')?.p).toEqual([
    -3, 0, -5,
  ]);
  await button(page, 'Continue plant A').click();
  await play(page);
  await page.waitForFunction((count) => {
    const s = (window.__marsEngine as PlantingHook).seedPlanting(),
      b = s.action?.seedbed;
    return (
      s.action?.phase === 'sowing' &&
      !!b &&
      !('code' in b) &&
      b.deposits > count &&
      b.deposits < 4
    );
  }, original.deposits);
  await freeze(page);
  const beforeEnd = await inspect(page);
  await button(page, 'End planting').click();
  await play(page);
  await terminal(page, 'cancelled');
  const ended = await capture(
    page,
    'seed-planting-rotated-end-preserves-partial-material',
  );
  clean(ended);
  returned(ended, initial);
  conservation(ended);
  markers(ended);
  expect(bed(ended, 'planter-a')).toEqual(bed(beforeEnd, 'planter-a'));
  expect(ended.planting.source?.contents?.fraction).toBe(
    beforeEnd.planting.source?.contents?.fraction,
  );
  expect(bed(ended, 'planter-a').purpose).toBe(original.purpose);
  expect(bed(ended, 'planter-a').completed).toBe(false);
  await button(page, 'Continue plant A').click();
  const admitted = await inspect(page);
  expect(bed(admitted, 'planter-a').purpose).toBe(original.purpose);
  expect(bed(admitted, 'planter-a').deposited).toBe(
    bed(ended, 'planter-a').deposited,
  );
  await play(page);
  await terminal(page, 'completed');
  const complete = await capture(
    page,
    'seed-planting-rotated-completed-same-source-return',
  );
  clean(complete);
  returned(complete, initial);
  conservation(complete);
  markers(complete);
  sameFixtures(complete, initial);
  expect(bed(complete, 'planter-a')).toMatchObject({
    completed: true,
    deposits: 4,
    deposited: 0.25,
    purpose: original.purpose,
  });
  expect(bed(complete, 'planter-b')).toMatchObject({
    completed: false,
    deposits: 0,
    deposited: 0,
  });
  expect(complete.planting.source?.contents?.fraction).toBe(0.25);
  await reset(page);
  expect(errors.get(page)).toEqual([]);
  save('seed-planting-rotated-proof', {
    initial,
    partialA,
    directed,
    beforeEnd,
    ended,
    admitted,
    complete,
  });
});
