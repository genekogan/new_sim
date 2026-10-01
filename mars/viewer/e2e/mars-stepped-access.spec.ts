/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
type WalkState = { active: boolean; grounded: boolean; position: number[]; access: { tagged: string[]; refused: unknown[] } };
type WalkWindow = { __marsStudio: { walking(): WalkState; look(position: number[], target: number[]): void }; __marsWalkSampling: boolean; __marsWalkSamples: WalkState[] };
const artifacts = path.resolve('e2e/artifacts', process.env.E2E_RUN ?? 'mars-stepped-access');
test('actual Chiba auditorium supports continuous WASD ascent and descent without a jump', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/studio');
  await page.waitForFunction(() => (window as unknown as WalkWindow).__marsStudio?.walking().access.tagged.length === 9);
  const access = await page.evaluate(() => (window as unknown as WalkWindow).__marsStudio.walking().access);
  expect(access.refused).toEqual([]);
  expect(access.tagged).toEqual(['0758', '0752', '0756', '0754', '0727', '0804', '0826', '0806', '1814'].map(id => `wood_component-${id}`));
  mkdirSync(artifacts, { recursive: true });
  await page.evaluate(() => (window as unknown as WalkWindow).__marsStudio.look([8, 11, 16], [0, 1.5, 7]));
  await page.screenshot({ path: path.join(artifacts, 'chiba-designated-access-overview.png') });
  await page.evaluate(() => (window as unknown as WalkWindow).__marsStudio.look([4.353906, 1.91308, 8.674103], [-3.334258, 1.91308, 5.048894]));
  await page.getByRole('button', { name: 'Walk · WASD', exact: true }).click();
  await expect(page.locator('.walk-instructions')).toContainText('Furniture remains an obstacle');
  const start = await page.evaluate(() => (window as unknown as WalkWindow).__marsStudio.walking());
  expect(start.active).toBe(true); expect(start.grounded).toBe(true);
  expect(start.position[1]).toBeCloseTo(1.91308, 4);
  await page.evaluate(() => {
    const w = window as unknown as WalkWindow;
    w.__marsWalkSampling = true; w.__marsWalkSamples = [];
    const sample = () => { if (!w.__marsWalkSampling) return; w.__marsWalkSamples.push(w.__marsStudio.walking()); requestAnimationFrame(sample); };
    sample();
  });
  await page.keyboard.down('w');
  await page.waitForFunction(() => (window as unknown as WalkWindow).__marsStudio.walking().position[0] <= -3.334258, undefined, { timeout: 30_000 });
  await page.keyboard.up('w');
  const top = await page.evaluate(() => (window as unknown as WalkWindow).__marsStudio.walking());
  expect(top.position[1]).toBeCloseTo(4.802293, 3); expect(top.grounded).toBe(true);
  await page.screenshot({ path: path.join(artifacts, 'chiba-wasd-upper-tier.png') });
  // Back down from the actual attained pose; no reseeding or artificial movement.
  await page.keyboard.down('s');
  await page.waitForFunction(() => (window as unknown as WalkWindow).__marsStudio.walking().position[0] >= 4.353906, undefined, { timeout: 30_000 });
  await page.keyboard.up('s');
  const end = await page.evaluate(() => {
    const w = window as unknown as WalkWindow; w.__marsWalkSampling = false;
    return { state: w.__marsStudio.walking(), samples: w.__marsWalkSamples };
  });
  expect(end.state.position[1]).toBeCloseTo(start.position[1], 3); expect(end.state.grounded).toBe(true);
  expect(end.samples.length).toBeGreaterThan(20);
  expect(end.samples.every(s => s.active && s.grounded), JSON.stringify(end.samples.filter(s => !s.grounded))).toBe(true);
  await page.screenshot({ path: path.join(artifacts, 'chiba-wasd-returned-to-entry.png') });
  await page.getByRole('button', { name: 'Exit walk', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as WalkWindow).__marsStudio.walking().active)).toBe(false);
  expect(errors).toEqual([]);
});
