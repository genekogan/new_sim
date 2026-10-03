/// <reference types="node" />
import { test, expect } from '@playwright/test';
import type { EngineHook } from '../app/lab/hook.ts';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
declare global { interface Window { __marsEngine: EngineHook } }
const artifacts = path.resolve('e2e/artifacts', process.env.E2E_RUN ?? 'workstation-appearance');
async function ready(page: import('@playwright/test').Page) {
  await page.goto('/lab?scenario=design-studio');
  await page.waitForFunction(() => window.__marsEngine?.ready);
  await page.evaluate(() => window.__marsEngine.runScenario('design-studio', { paused: true }));
}
async function notes(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Start notes', exact: true }).click();
  await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) {
      const state = window.__marsEngine.workstation().state;
      if (!('code' in state) && state.elapsed >= 2) return;
      window.__marsEngine.step();
    }
    throw Error('Editor did not use the computer');
  });
}
async function capture(page: import('@playwright/test').Page, file: string) {
  mkdirSync(artifacts, { recursive: true });
  await page.evaluate(() => window.__marsEngine.camera([10, 2.7, -7], [8, 1, -4]));
  await page.getByTestId('workstation-appearance').scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({ path: path.join(artifacts, file) });
}
test('attributed imported computer stays inside the supported envelope while an NPC works', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await ready(page);
  await page.waitForFunction(() => window.__marsEngine.workstationAppearances()[0]?.status === 'ready');
  const appearance = await page.evaluate(() => window.__marsEngine.workstationAppearances()[0]);
  expect(appearance.id).toBe('studio-computer');
  expect(appearance.bounds).toBeDefined();
  const box = appearance.bounds!;
  expect(box.min[0]).toBeGreaterThanOrEqual(-0.7);
  expect(box.max[0]).toBeLessThanOrEqual(0.7);
  expect(box.min[1]).toBeGreaterThanOrEqual(0.74);
  expect(box.max[1]).toBeLessThanOrEqual(1.3);
  expect(box.min[2]).toBeGreaterThanOrEqual(-0.375);
  expect(box.max[2]).toBeLessThanOrEqual(0.375);
  await expect(page.getByTestId('workstation-appearance')).toContainText('JasperTobias');
  await expect(page.getByTestId('workstation-appearance')).toContainText('CC BY 4.0');
  await notes(page);
  const work = await page.evaluate(() => window.__marsEngine.workstation().state);
  expect('code' in work).toBe(false);
  if (!('code' in work)) { expect(work.user).toBe('project-editor'); expect(work.task).toBe('Prototype project notes'); expect(work.elapsed).toBeGreaterThanOrEqual(2); }
  expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual([]);
  await capture(page, 'imported-computer-npc-work.png');
  expect(errors).toEqual([]);
});
test('missing imported appearance is named visibly while the same workstation remains usable', async ({ page }) => {
  await page.route('**/models/retro-computer-monitor.glb', route => route.fulfill({ status: 503, body: 'Injected unavailable asset' }));
  await ready(page);
  await page.waitForFunction(() => window.__marsEngine.workstationAppearances()[0]?.status === 'failed');
  await expect(page.getByRole('alert')).toContainText('appearance.load-failed');
  await expect(page.getByRole('alert')).toContainText('primitive');
  expect(await page.evaluate(() => window.__marsEngine.error)).toBe('');
  await notes(page);
  expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual([]);
  await capture(page, 'imported-computer-fallback.png');
});
test('repeated imported-computer resets and switching worlds release old renderer assets', async ({ page }) => {
  const model = readFileSync(path.resolve('public/models/retro-computer-monitor.glb'));
  let delayed = false;
  await page.route('**/models/retro-computer-monitor.glb', async route => {
    // Serve the initial model immediately, then force the reset fallback to render
    // while loading. The same strict baseline must hold after either arrival order.
    if (delayed) await new Promise(resolve => setTimeout(resolve, 250));
    await route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: model });
  });
  await ready(page);
  await page.waitForFunction(() => window.__marsEngine.workstationAppearances()[0]?.status === 'ready');
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const baseline = await page.evaluate(() => window.__marsEngine.info());
  const resets: typeof baseline[] = [];
  delayed = true;
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.waitForFunction(() => window.__marsEngine.workstationAppearances()[0]?.status === 'ready');
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const info = await page.evaluate(() => window.__marsEngine.info());
    resets.push(info);
    expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual([]);
  }
  for (const info of resets) {
    const counts = (x: typeof baseline) => ({ geometries: x.geometries, textures: x.textures });
    const detail = JSON.stringify({ baseline: counts(baseline), resets: resets.map(counts) });
    expect(info.geometries, detail).toBeLessThanOrEqual(baseline.geometries);
    expect(info.textures, detail).toBeLessThanOrEqual(baseline.textures);
  }
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(path.join(artifacts, 'imported-computer-reset-resources.json'), JSON.stringify({ baseline, resets }, null, 2));
  await capture(page, 'imported-computer-after-delayed-resets.png');
  await page.getByRole('combobox', { name: 'Scenario', exact: true }).selectOption('work-break-4');
  await expect(page.getByTestId('workstation-appearance')).toHaveCount(0);
  expect(await page.evaluate(() => window.__marsEngine.workstationAppearances())).toEqual([]);
  await expect(page.getByTestId('purposeful-routine-hud')).toContainText('Sketch notes');
});
