// Studio "Replay take": the flagship build recorded on the real 2026 campus
// (deploy/record-campus-take.mjs) replayed on top of the studio scene with the
// engine-planned camera, plus one frame from a user camera. Captures:
// artifacts/<run>/studio-take-{carry,held,deck,visitor,user-camera}.png;
// baselines: studio-take-held, studio-take-visitor.
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { captureView, collectConsoleErrors, lookAt, openStudio, waitFrames, writeArtifact } from './helpers';

type TakeInfo = {
  id: string;
  t: number;
  duration: number;
  engineCamera: boolean;
  entities: number;
  rendered: { components: number; humans: number };
  finalStateHash: string;
  recordedFinalStateHash: string;
  poseHash: string;
  shot: string;
};
const manifest = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../public/engine/takes/manifest.json'), 'utf8'));
const entry = manifest.takes[0];
const MOMENTS = ['carry', 'held', 'deck', 'visitor'] as const;
const BASELINED = new Set(['held', 'visitor']);

const info = (page: Page) => page.evaluate(() => (window.__marsStudio as unknown as { take: () => TakeInfo | null }).take());
const camera = (page: Page) => page.evaluate(() => document.querySelector<HTMLCanvasElement>('.studio canvas')!.dataset.cameraPosition);

async function scrub(page: Page, t: number) {
  await page.getByRole('slider', { name: 'Take time scrubber' }).fill(String(t));
  await page.waitForFunction((want) => {
    const i = (window.__marsStudio as unknown as { take: () => TakeInfo | null }).take();
    return !!i && Math.abs(i.t - want) < 0.051;
  }, t);
  await waitFrames(page, 4);
}

test('studio take replay: flagship build on the 2026 campus, engine camera + user camera', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const errors = collectConsoleErrors(page);
  await openStudio(page);
  const picker = page.getByRole('combobox', { name: 'Replay take' });
  await expect(picker).toBeVisible();
  await picker.selectOption(entry.id);
  await page.waitForFunction(() => !!(window.__marsStudio as unknown as { take: () => unknown }).take(), null, { timeout: 60_000 });
  await expect(page.getByRole('note').filter({ hasText: 'HYPOTHETICAL build scenario — not historical' })).toBeVisible();

  const first = (await info(page))!;
  expect(first.id).toBe(entry.id);
  expect(first.finalStateHash, 'final state hashes to the recorded hash').toBe(first.recordedFinalStateHash);
  expect(first.finalStateHash, 'final-state hash matches the manifest').toBe(entry.finalStateHash);
  expect(first.duration).toBeCloseTo(entry.duration, 3);
  expect(first.engineCamera).toBe(true);

  const report: Record<string, unknown> = {};
  for (const name of MOMENTS) {
    const t = entry.moments[name];
    await scrub(page, t);
    const i = (await info(page))!;
    expect(i.entities, `${name}: sampled entity count`).toBe(entry.entities);
    expect(i.rendered.components + i.rendered.humans, `${name}: every sampled entity is drawn`).toBe(entry.entities);
    report[name] = { t: i.t, shot: i.shot, camera: await camera(page), poseHash: i.poseHash };
    await captureView(page, `studio-take-${name}`, { testInfo, compare: BASELINED.has(name) });
  }

  // Same take time with the engine camera off and a user camera: identical entity poses (spec §18).
  await scrub(page, entry.moments.held);
  const withEngine = (await info(page))!;
  await page.getByRole('checkbox', { name: 'Engine camera' }).uncheck();
  await lookAt(page, [22, 34, 46], [15, 0, -1]); // high oblique from the south: Chiba (west) and the build (east) together
  const withUser = (await info(page))!;
  expect(withUser.engineCamera).toBe(false);
  expect(withUser.poseHash, 'take plays identically with the user camera').toBe(withEngine.poseHash);
  // canvas data-camera-position refreshes once a second
  await page.waitForFunction(() => document.querySelector<HTMLCanvasElement>('.studio canvas')!.dataset.cameraPosition === '22.00,34.00,46.00', null, { timeout: 5_000 });
  await captureView(page, 'studio-take-user-camera', { testInfo, compare: false });
  report.userCamera = { t: withUser.t, poseHash: withUser.poseHash };

  // Closing the take removes the overlay.
  await page.getByRole('combobox', { name: 'Replay take' }).selectOption('');
  await expect(page.getByRole('note').filter({ hasText: 'HYPOTHETICAL build scenario — not historical' })).toHaveCount(0);
  expect(await info(page)).toBeNull();

  writeArtifact('studio-take.json', { take: entry.id, finalStateHash: entry.finalStateHash, entities: entry.entities, moments: report });
  expect(errors, 'console/page errors').toEqual([]);
});
