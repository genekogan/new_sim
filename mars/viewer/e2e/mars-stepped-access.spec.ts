/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
type WalkState = { active: boolean; grounded: boolean; position: number[]; access: { tagged: string[]; refused: unknown[] } };
type WalkWindow = { __marsStudio: { frames: number; walking(): WalkState; look(position: number[], target: number[]): void }; __marsWalkSampling: boolean; __marsWalkSamples: WalkState[] };
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
  // Frozen photographed furnishings occupy the former v5.7 centerline.
  // Follow the clear v4.1 aisle, with the same actual lower/upper support heights.
  await page.evaluate(() => (window as unknown as WalkWindow).__marsStudio.look([3.671513, 1.91308, 10.121287], [-4.016650, 1.91308, 6.496077]));
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
  await page.waitForFunction(() => (window as unknown as WalkWindow).__marsStudio.walking().position[0] <= -4.016650, undefined, { timeout: 30_000 });
  await page.keyboard.up('w');
  const top = await page.evaluate(() => (window as unknown as WalkWindow).__marsStudio.walking());
  expect(top.position[1]).toBeCloseTo(4.802293, 3); expect(top.grounded).toBe(true);
  await page.screenshot({ path: path.join(artifacts, 'chiba-wasd-upper-tier.png') });
  // Back down from the actual attained pose; no reseeding or artificial movement.
  await page.keyboard.down('s');
  await page.waitForFunction(() => (window as unknown as WalkWindow).__marsStudio.walking().position[0] >= 3.671513, undefined, { timeout: 30_000 });
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

// The photographed table has a thin top between the three ordinary body rays.
// Check the actual untagged tabletop from its open rear, not just its front drape.
test('actual thin projector tabletop blocks entry from its open rear', async ({ page }, testInfo) => {
  await page.goto('/studio');
  await page.waitForFunction(() => (window as unknown as WalkWindow).__marsStudio?.walking().access.tagged.length === 9);
  mkdirSync(artifacts, { recursive: true });
  await page.evaluate(() => (window as unknown as WalkWindow).__marsStudio.look([5.040803, 1.91308, 8.975884], [3.910191, 1.91308, 8.442765]));
  await page.getByRole('button', { name: 'Walk · WASD', exact: true }).click();
  const start = await page.evaluate(() => (window as unknown as WalkWindow).__marsStudio.walking());
  expect(start.position[1]).toBeCloseTo(1.91308, 4);
  expect(start.access.refused).toEqual([]);
  expect(start.access.tagged.every(id => id.startsWith('wood_component-'))).toBe(true);
  await page.evaluate(() => {
    const w = window as unknown as WalkWindow;
    w.__marsWalkSampling = true; w.__marsWalkSamples = [];
    const sample = () => { if (!w.__marsWalkSampling) return; w.__marsWalkSamples.push(w.__marsStudio.walking()); requestAnimationFrame(sample); };
    sample();
  });
  const frame = await page.evaluate(() => (window as unknown as WalkWindow).__marsStudio.frames);
  await page.keyboard.down('w');
  await page.waitForFunction(f => (window as unknown as WalkWindow).__marsStudio.frames >= f + 40, frame);
  await page.keyboard.up('w');
  const proof = await page.evaluate(() => {
    const w = window as unknown as WalkWindow; w.__marsWalkSampling = false;
    return { state: w.__marsStudio.walking(), samples: w.__marsWalkSamples };
  });
  const yaw = -Math.atan2(.4265, .9045);
  const crossed = proof.samples.filter(sample => {
    const [x, eye, z] = sample.position;
    const dx = x + 8.47875, dz = z - 8.925;
    const u = Math.cos(yaw) * dx - Math.sin(yaw) * dz;
    const v = -Math.sin(yaw) * dx - Math.cos(yaw) * dz;
    // Exact cloth-top footprint, with the actual table top inside the body's
    // vertical volume. Passing around an edge remains ordinary legitimate slide.
    return u > 11.11 && u < 11.85 && v > 5.13 && v < 6.31 && eye - 1.7 < .99508 && eye > .99508;
  });
  await page.screenshot({ path: path.join(artifacts, 'chiba-projector-table-rear-collision.png') });
  await testInfo.attach('actual-tabletop-body-volume', { body: JSON.stringify({ ...proof, crossed }, null, 2), contentType: 'application/json' });
  expect(proof.samples.length).toBeGreaterThan(20);
  expect(crossed, 'camera body must not enter the untagged thin tabletop volume').toEqual([]);
  await page.getByRole('button', { name: 'Exit walk', exact: true }).click();
});
