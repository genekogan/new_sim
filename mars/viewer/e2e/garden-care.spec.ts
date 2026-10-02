/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
import type { Entity } from '../engine/world/types.ts';
import type { readGarden } from '../engine/objects/garden.ts';
declare global { interface Window { __marsEngine: EngineHook } }
type Plant = Exclude<ReturnType<typeof readGarden>, { code: string }>;
type GardenSnapshot = { plants: Plant[]; water: Entity; active: { status: string; phase?: string } | null; claims: Record<string, string[]> };
type GardenHook = EngineHook & { garden: () => GardenSnapshot };
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
    return !hook.garden().active && hook.records().filter(r => r.verb === 'walk_to').at(-1)?.status === 'completed';
  });
  await button('Pause').click(); const handoff = await assertClean();
  expect(handoff.plants[0].pending).toEqual(handoffPartial.plants[0].pending);
  expect(handoff.water.contents).toEqual(handoffPartial.water.contents);
  await page.screenshot({ path: path.join(artifacts, 'garden-director-safe-handoff.png') });
  expect(errors).toEqual([]);
  writeFileSync(path.join(artifacts, 'garden-care-proof.json'), JSON.stringify({ original, partial, stopped, first, both, repeats, depleted, empty, handoffPartial, handoff, errors }, null, 2));
});
