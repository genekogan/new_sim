import { test, expect } from '@playwright/test';
import { openLab, labFrames } from './lab-helpers.ts';
import { captureView, collectConsoleErrors } from './helpers.ts';

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
  await expect.poll(() => page.evaluate(() => window.__marsEngine!.state().tick)).toBe(20);
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
