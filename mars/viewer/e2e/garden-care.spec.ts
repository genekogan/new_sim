/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { EngineHook } from '../app/lab/hook.ts';
import type { Entity } from '../engine/world/types.ts';
import type { readGarden } from '../engine/objects/garden.ts';
declare global { interface Window { __marsEngine: EngineHook } }
type Plant = Exclude<ReturnType<typeof readGarden>, { code: string }>;
type GardenSnapshot = { plants: Plant[]; water: Entity; active: { status: string; phase?: string } | null; claims: Record<string, string[]> };
type GardenHook = Omit<EngineHook, 'garden'> & { garden: () => GardenSnapshot };
const artifacts = path.resolve('e2e/artifacts', process.env.E2E_RUN ?? 'garden-care');

test('garden-care: actual Play partial return, both plants, repeat due, finite exhaustion and director handoff', async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(artifacts, { recursive: true });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/lab?scenario=garden-care');
  await page.waitForFunction(() => window.__marsEngine?.ready);
  await page.evaluate(async () => {
    await window.__marsEngine.runScenario('garden-care', { paused: true, speed: 4 });
    window.__marsEngine.camera([8, 7, 10], [0, .6, .3]);
  });
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const state = () => page.evaluate(() => (window.__marsEngine as GardenHook).garden());
  const assertClean = async () => {
    const s = await state();
    expect(s.active).toBeNull(); expect(Object.values(s.claims).flat()).toEqual([]);
    expect(s.water.support).toEqual({ kind: 'resting-on', on: 'water-table', slot: 'r0c2' });
    expect(s.water.contents!.fraction + s.plants.reduce((sum, p) => sum + p.waterReceived, 0)).toBe(1);
    expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual([]);
    expect(await page.evaluate(() => window.__marsEngine.heldItems())).toEqual([]);
    return s;
  };
  await button('Step').click();
  const original = await assertClean();
  expect(original.plants.map(p => [p.plant, p.cycles, p.due])).toEqual([['plant-a', 0, true], ['plant-b', 0, true]]);
  expect(original.water.contents).toEqual({ food: 'water', fraction: 1 });
  await button('Care for selected plant').click(); await button('Play').click();
  await page.waitForFunction(() => {
    const s = (window.__marsEngine as GardenHook).garden();
    return !!s.plants[0].pending && s.plants[0].pending.delivered > 0 && s.plants[0].pending.delivered < .25;
  });
  await button('Pause').click();
  const partial = await state();
  expect(partial.water.support).toEqual({ kind: 'in-hand', by: 'carer', hand: 'right' });
  expect(partial.water.contents!.fraction + partial.plants[0].waterReceived).toBe(1);
  await page.screenshot({ path: path.join(artifacts, 'garden-partial-held-water.png') });
  await button('Pause care').click(); await button('Play').click();
  await page.waitForFunction(() => !(window.__marsEngine as GardenHook).garden().active);
  await button('Pause').click();
  const stopped = await assertClean();
  expect(stopped.plants[0].pending).toEqual(partial.plants[0].pending);
  expect(stopped.plants[0].waterReceived).toBe(partial.plants[0].waterReceived);
  expect(stopped.water.contents).toEqual(partial.water.contents);
  expect(stopped.water.pose).toEqual(original.water.pose);
  await page.screenshot({ path: path.join(artifacts, 'garden-retained-safe-return.png') });
  await button('Resume retained care').click(); await button('Play').click();
  await page.waitForFunction(() => !(window.__marsEngine as GardenHook).garden().active);
  await button('Pause').click();
  const first = await assertClean();
  expect(first.plants[0].cycles).toBe(1); expect(first.plants[0].pending).toBeUndefined();
  expect(first.water.contents!.fraction).toBe(.75);
  const completePlant = async (plant: string) => {
    await page.getByRole('combobox', { name: 'Planter', exact: true }).selectOption(plant);
    await button('Care for selected plant').click(); await button('Play').click();
    await page.waitForFunction(() => !(window.__marsEngine as GardenHook).garden().active);
    await button('Pause').click(); return assertClean();
  };
  const both = await completePlant('plant-b');
  expect(both.plants.map(p => p.cycles)).toEqual([1, 1]); expect(both.water.contents!.fraction).toBe(.5);
  await page.screenshot({ path: path.join(artifacts, 'garden-both-plants-cared.png') });
  const repeats: GardenSnapshot[] = [];
  for (const plant of ['plant-a', 'plant-b']) {
    const before = await state(), p = before.plants.find(p => p.plant === plant)!;
    await page.evaluate(ticks => window.__marsEngine.step(ticks), p.remainingTicks);
    expect((await state()).plants.find(p => p.plant === plant)!.due).toBe(true);
    repeats.push(await completePlant(plant));
  }
  const depleted = await assertClean();
  expect(depleted.plants.map(p => p.cycles)).toEqual([2, 2]); expect(depleted.water.contents!.fraction).toBe(0);
  expect([depleted.water.id, depleted.water.def]).toEqual([original.water.id, original.water.def]);
  await page.evaluate(ticks => window.__marsEngine.step(ticks), depleted.plants[0].remainingTicks);
  await page.getByRole('combobox', { name: 'Planter', exact: true }).selectOption('plant-a');
  await button('Care for selected plant').click();
  await expect(page.getByTestId('garden-care-feedback')).toContainText('garden_care.water-unavailable');
  await page.screenshot({ path: path.join(artifacts, 'garden-empty-water-refusal.png') });
  const empty = await assertClean(); expect(empty.water.contents!.fraction).toBe(0);
  await button('Reset').click();
  expect((await state()).water.contents!.fraction).toBe(1);
  await button('Care for selected plant').click(); await button('Play').click();
  await page.waitForFunction(() => ((window.__marsEngine as GardenHook).garden().plants[0].pending?.delivered ?? 0) > 0);
  await button('Pause').click(); const handoffPartial = await state();
  await button('Direct carer away').click(); await button('Play').click();
  await page.waitForFunction(() => {
    const hook = window.__marsEngine as GardenHook;
    return !hook.garden().active && hook.records().filter(r => r.verb === 'walk_to' && !r.parent).at(-1)?.status === 'completed';
  });
  await button('Pause').click(); const handoff = await assertClean();
  expect(handoff.plants[0].pending).toEqual(handoffPartial.plants[0].pending);
  expect(handoff.water.contents).toEqual(handoffPartial.water.contents);
  await page.screenshot({ path: path.join(artifacts, 'garden-director-safe-handoff.png') });
  expect(errors).toEqual([]);
  writeFileSync(path.join(artifacts, 'garden-care-proof.json'), JSON.stringify({ original, partial, stopped, first, both, repeats, depleted, empty, handoffPartial, handoff, errors }, null, 2));
});

// Whole finite journey: UI time also owns the 600-tick due intervals.
// The older mixed regression above remains intact for its interruption coverage.
test('garden-care: full UI Play due waits, four conserved care cycles and depleted reservoir refusal', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const freeze = async () => {
    if (!(await page.evaluate(() => window.__marsEngine.state().paused))) await button('Pause').click();
  };
  const play = async () => {
    if (await page.evaluate(() => window.__marsEngine.state().paused)) await button('Play').click();
  };
  const snapshot = () => page.evaluate(() => {
    const h = window.__marsEngine as GardenHook;
    return { state: h.state(), garden: h.garden(), records: h.records(), held: h.heldItems(), slots: h.slots(), violations: h.violations() };
  });
  type Evidence = Awaited<ReturnType<typeof snapshot>>;
  const checkpoints: Record<string, Evidence> = {};
  const clean = (s: Evidence, original: Evidence, refusal = false) => {
    expect(s.violations).toEqual([]);
    expect(s.garden.active).toBeNull();
    expect(s.held).toEqual([]);
    expect(Object.values(s.garden.claims).flat()).toEqual([]);
    expect(s.slots.filter(slot => slot.claimedBy !== null || slot.occupant !== null)).toEqual([]);
    expect(s.state.humans.filter(h => h.task !== null)).toEqual([]);
    expect(s.records.filter(r => !['completed', 'cancelled', 'failed'].includes(r.status))).toEqual([]);
    expect(s.records.filter(r => r.status === 'failed').map(r => r.diagnostic?.code)).toEqual(refusal ? ['garden_care.water-unavailable'] : []);
    expect(s.garden.water.support).toEqual({ kind: 'resting-on', on: 'water-table', slot: 'r0c2' });
    expect({ id: s.garden.water.id, def: s.garden.water.def, pose: s.garden.water.pose, provenance: s.garden.water.provenance }).toEqual({ id: original.garden.water.id, def: original.garden.water.def, pose: original.garden.water.pose, provenance: original.garden.water.provenance });
    expect(s.garden.water.contents!.fraction + s.garden.plants.reduce((sum, p) => sum + p.waterReceived, 0)).toBe(1);
  };
  const capture = async (label: string) => {
    await freeze();
    const s = await snapshot();
    checkpoints[label] = s;
    mkdirSync(artifacts, { recursive: true });
    await page.screenshot({ path: path.join(artifacts, `garden-full-play-${label}.png`) });
    writeFileSync(path.join(artifacts, `garden-full-play-${label}.a11y.yml`), await page.locator('body').ariaSnapshot());
    return s;
  };
  let completed = false;
  try {
    await page.goto('/lab?scenario=garden-care');
    await page.waitForFunction(() => window.__marsEngine?.ready);
    await freeze();
    await button('Reset').click();
    await page.waitForFunction(() => window.__marsEngine.ready && window.__marsEngine.state().paused && window.__marsEngine.state().tick === 0);
    await page.getByRole('combobox', { name: 'Speed', exact: true }).selectOption('4');
    const initial = await capture('initial');
    expect(initial.state.scenario).toBe('garden-care');
    expect(initial.records).toEqual([]);
    expect(initial.garden.plants.map(p => [p.plant, p.cycles, p.due])).toEqual([['plant-a', 0, true], ['plant-b', 0, true]]);
    clean(initial, initial);
    const waitDue = async (plant: string, label: string, mustWait: boolean) => {
      const before = await snapshot(), p = before.garden.plants.find(p => p.plant === plant)!;
      expect(p.pending).toBeUndefined();
      expect(p.remainingTicks).toBe(Math.max(0, p.lastCareTick! + 600 - before.state.tick));
      if (mustWait) expect(p.remainingTicks).toBeGreaterThan(0);
      await play();
      await page.waitForFunction(plant => {
        const h = window.__marsEngine as GardenHook;
        if (h.error || h.violations().length || h.records().some(r => r.status === 'failed')) throw Error('garden due wait halted or failed');
        return h.garden().plants.find(p => p.plant === plant)?.due === true;
      }, plant);
      const due = await capture(label), after = due.garden.plants.find(p => p.plant === plant)!;
      expect(due.state.tick).toBeGreaterThanOrEqual(p.lastCareTick! + 600);
      expect(after.remainingTicks).toBe(0);
      expect(after.cycles).toBe(p.cycles);
      expect(after.waterReceived).toBe(p.waterReceived);
      expect(due.garden.water.contents).toEqual(before.garden.water.contents);
      clean(due, initial);
    };
    const care = async (plant: string, cycle: number) => {
      await page.getByRole('combobox', { name: 'Planter', exact: true }).selectOption(plant);
      const before = await snapshot();
      expect(before.garden.plants.find(p => p.plant === plant)?.due).toBe(true);
      await button('Care for selected plant').click();
      await play();
      await page.waitForFunction(({ plant, cycle }) => {
        const h = window.__marsEngine as GardenHook;
        if (h.error || h.violations().length || h.records().some(r => r.status === 'failed')) throw Error('garden care halted or failed');
        const s = h.garden();
        return !s.active && s.plants.find(p => p.plant === plant)?.cycles === cycle;
      }, { plant, cycle });
      const end = await capture(`${plant}-cycle-${cycle}`);
      expect(end.garden.plants.find(p => p.plant === plant)).toMatchObject({ cycles: cycle, waterReceived: cycle * 0.25, pending: undefined });
      expect(end.garden.water.contents!.fraction).toBe(before.garden.water.contents!.fraction - 0.25);
      clean(end, initial);
    };
    await care('plant-a', 1);
    await care('plant-b', 1);
    await waitDue('plant-a', 'repeat-a-due', true);
    await care('plant-a', 2);
    await waitDue('plant-b', 'repeat-b-due', false);
    await care('plant-b', 2);
    const depleted = await snapshot();
    expect(depleted.garden.water.contents!.fraction).toBe(0);
    expect(depleted.garden.plants.map(p => [p.cycles, p.waterReceived])).toEqual([[2, 0.5], [2, 0.5]]);
    expect(depleted.records.filter(r => r.verb === 'garden_care' && r.status === 'completed')).toHaveLength(4);
    await waitDue('plant-a', 'depleted-a-due', true);
    await page.getByRole('combobox', { name: 'Planter', exact: true }).selectOption('plant-a');
    await button('Care for selected plant').click();
    await expect(page.getByTestId('garden-care-feedback')).toContainText('garden_care.water-unavailable');
    const refused = await capture('depleted-refusal');
    clean(refused, initial, true);
    expect(refused.garden.plants).toEqual(checkpoints['depleted-a-due'].garden.plants);
    expect(refused.garden.water).toEqual(depleted.garden.water);
    expect(refused.records.filter(r => r.verb === 'garden_care' && r.status === 'completed')).toHaveLength(4);
    await button('Reset').click();
    await page.waitForFunction(() => window.__marsEngine.ready && window.__marsEngine.state().paused && window.__marsEngine.state().tick === 0);
    const reset = await capture('reset');
    expect(reset.records).toEqual([]);
    expect(reset.garden.water).toEqual(initial.garden.water);
    expect(reset.garden.plants.map(p => [p.cycles, p.waterReceived, p.pending])).toEqual([[0, 0, undefined], [0, 0, undefined]]);
    clean(reset, initial);
    expect(errors).toEqual([]);
    completed = true;
  } finally {
    mkdirSync(artifacts, { recursive: true });
    const file = path.join(artifacts, 'garden-full-ui-play-proof.json');
    writeFileSync(file, JSON.stringify({ source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), run: process.env.E2E_RUN, test: testInfo.title, completed, nativeStatusAtFinally: testInfo.status, advancement: 'UI Play only; no hook stepping, reload, mutation or Step', checkpoints, final: await snapshot().catch(() => null), errors }, null, 2));
    await testInfo.attach('garden-full-ui-play-proof', { path: file, contentType: 'application/json' });
  }
});
