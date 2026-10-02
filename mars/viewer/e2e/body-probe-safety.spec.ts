import { test, expect } from '@playwright/test';
import type { EngineHook } from '../app/lab/hook.ts';
import { openLab, labFrames } from './lab-helpers.ts';
import { captureView, collectConsoleErrors } from './helpers.ts';

test('delayed playback frames end scripted windows while the unchanged valid world clock continues', async ({ page }) => {
  await openLab(page, 'body');
  const result = await page.evaluate(async () => {
    const moduleUrl = '/app/lab/sim.ts';
    const { LabSim } = await import(moduleUrl);
    const budget = new LabSim();
    budget.load('body');
    budget.stepN(19);
    const humans = structuredClone(budget.rt.world.entities);
    let budgetBoundary: { tick: number; reason: string } | null = null;
    budget.onTick = (rt: { tick: number }) => {
      if (!budgetBoundary && budget.scriptStopReason) budgetBoundary = { tick: rt.tick, reason: budget.scriptStopReason };
    };
    budget.advance(0.25);
    const first = budget.rt.tick;
    budget.advance(0.25);
    const completion = new LabSim();
    completion.load('body');
    completion.scenario = { ...completion.scenario, continuous: false, done: (rt: { tick: number }) => rt.tick >= 2 };
    completion.advance(0.25);
    return { first, repeated: budget.rt.tick, budgetBoundary, done: budget.done(), scriptStopReason: budget.scriptStopReason, violations: budget.rt.violations,
      unchanged: JSON.stringify(humans) === JSON.stringify(budget.rt.world.entities),
      completion: completion.rt.tick, completed: completion.done(), completionReason: completion.scriptStopReason };
  });
  expect(result).toEqual({ first: 24, repeated: 29, budgetBoundary: { tick: 20, reason: 'budget' }, done: true, scriptStopReason: 'budget', violations: [], unchanged: true, completion: 5, completed: true, completionReason: 'terminal' });
});

test('body probe selectable Step, Reset and Play validate a safe still world', async ({ page }, testInfo) => {
  const errors = collectConsoleErrors(page);
  await openLab(page);
  await page.evaluate(() => window.__marsEngine!.pause(true));
  await page.getByRole('combobox', { name: 'Scenario', exact: true }).selectOption('body');
  await expect.poll(() => page.evaluate(() => window.__marsEngine!.state().scenario)).toBe('body');
  const fresh = await page.evaluate(() => window.__marsEngine!.state());
  expect(fresh.tick).toBe(0);
  expect(fresh.done).toBe(false);
  expect(await page.evaluate(() => window.__marsEngine!.violations())).toEqual([]);
  await page.getByRole('button', { name: 'Step', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__marsEngine!.state().tick)).toBe(1);
  expect((await page.evaluate(() => window.__marsEngine!.state())).humans).toEqual(fresh.humans);
  expect(await page.evaluate(() => window.__marsEngine!.violations())).toEqual([]);
  await labFrames(page);
  await captureView(page, 'body-probe-first-step', { testInfo, compare: false });
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__marsEngine!.state().tick)).toBe(0);
  expect((await page.evaluate(() => window.__marsEngine!.state())).humans).toEqual(fresh.humans);
  await page.getByRole('button', { name: 'Step', exact: true }).click();
  expect(await page.evaluate(() => window.__marsEngine!.violations())).toEqual([]);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window.__marsEngine as unknown as EngineHook).state().scriptStopReason)).toBe('budget');
  const budgetTick = await page.evaluate(() => window.__marsEngine!.state().tick);
  expect(budgetTick).toBeGreaterThanOrEqual(20);
  await expect.poll(() => page.evaluate(() => window.__marsEngine!.state().tick)).toBeGreaterThan(budgetTick + 3);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const pausedTick = await page.evaluate(() => window.__marsEngine!.state().tick);
  await labFrames(page, 4);
  expect(await page.evaluate(() => window.__marsEngine!.state().tick)).toBe(pausedTick);
  await page.getByRole('button', { name: 'Step', exact: true }).click();
  expect(await page.evaluate(() => window.__marsEngine!.state().tick)).toBe(pausedTick + 1);
  const played = await page.evaluate(() => window.__marsEngine!.state());
  expect(played.done).toBe(true);
  expect(played.humans).toEqual(fresh.humans);
  expect(played.checks.every(c => c.ok)).toBe(true);
  expect(await page.evaluate(() => window.__marsEngine!.violations())).toEqual([]);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await captureView(page, 'body-probe-play', { testInfo, compare: false });
  expect(errors).toEqual([]);
});

test('synthetic body probe does not change authoritative world or Step outcome', async ({ page }) => {
  await openLab(page, 'body');
  await page.evaluate(() => window.__marsEngine!.runScenario('body', { paused: true }));
  const before = await page.evaluate(() => ({ hash: window.__marsEngine!.stateHash(), state: window.__marsEngine!.state() }));
  await page.evaluate(() => {
    const hook = window.__marsEngine! as unknown as { probe(id: string, spec: unknown): unknown };
    hook.probe('b1', { activity: 'reach_down', hands: { left: [14.4, 2.7, 8.35], right: [14.4, 2.7, 8.65] } });
  });
  expect(await page.evaluate(() => window.__marsEngine!.stateHash())).toBe(before.hash);
  expect(await page.evaluate(() => window.__marsEngine!.state())).toEqual(before.state);
  await page.getByRole('button', { name: 'Step', exact: true }).click();
  expect(await page.evaluate(() => window.__marsEngine!.violations())).toEqual([]);
  expect((await page.evaluate(() => window.__marsEngine!.state())).humans).toEqual(before.state.humans);
});
