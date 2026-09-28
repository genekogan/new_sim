// Engine camera planner vs the real render (docs/engineering/CAMERA_VERIFY.md).
// Replays the flagship campus take in /studio and runs window.__marsStudio.verifyCamera
// over the whole take at 2 Hz: each planned camera pose ray-casts the planner's subject
// points against the meshes actually drawn (2026 GLB, studio scenery, take parts and
// people). Writes artifacts/<run>/camera-verify.json and screenshots of the three
// samples where the render disagrees most with the planner (engine camera on).
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { captureView, collectConsoleErrors, openStudio, waitFrames, writeArtifact } from './helpers';
import type { CameraVerifyReport } from '../app/studio/camera-verify';

const manifest = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../public/engine/takes/manifest.json'), 'utf8'));
const entry = manifest.takes[0];
type Hook = { take: () => { t: number; engineCamera: boolean } | null; verifyCamera: (fromT?: number, toT?: number, hz?: number) => Promise<CameraVerifyReport | null> };
const hook = (w: Window) => w.__marsStudio as unknown as Hook;

async function scrub(page: Page, t: number) {
  await page.getByRole('slider', { name: 'Take time scrubber' }).fill(String(t));
  await page.waitForFunction((want) => Math.abs(((window.__marsStudio as unknown as Hook).take()?.t ?? -1) - want) < 0.051, t);
  await waitFrames(page, 4);
}

test('camera verify: planned readability vs ray casts against the rendered meshes', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const errors = collectConsoleErrors(page);
  await openStudio(page);
  await page.getByRole('combobox', { name: 'Replay take' }).selectOption(entry.id);
  await page.waitForFunction(() => !!(window.__marsStudio as unknown as Hook).take(), null, { timeout: 60_000 });

  const report = (await page.evaluate((duration) => (window.__marsStudio as unknown as Hook).verifyCamera(0, duration, 2), entry.duration))!;
  expect(report).not.toBeNull();
  writeArtifact('camera-verify.json', report);
  const line = (x: CameraVerifyReport['worst'][number]) =>
    `t=${x.t} planner=${x.planner} real=${x.real} crewExempt=${x.realCrewExempt} [${x.shot}] occluder=${x.occluder} cam=${x.camera.join(',')}`;
  console.log(`camera-verify: ${report.samples} samples, meanPlanner ${report.meanPlanner}, meanReal ${report.meanReal} (crew-exempt ${report.meanRealCrewExempt}), maxAbsDiff ${report.maxAbsDiff}, hidden ${report.hiddenByRealMesh.count}, over-conservative ${report.overConservative.strict.count}/${report.overConservative.soft.count}, ${report.perf.totalMs} ms`);
  for (const x of report.worst) console.log(`  worst ${line(x)}`);

  // Look at the three largest disagreements with the engine camera driving the view.
  const shots = report.hiddenByRealMesh.count ? report.hiddenByRealMesh.samples : report.worst;
  for (const x of [...shots].sort((a, b) => b.planner - b.real - (a.planner - a.real)).slice(0, 3)) {
    await scrub(page, x.t);
    expect((await page.evaluate(() => (window.__marsStudio as unknown as Hook).take()))!.engineCamera).toBe(true);
    await captureView(page, `camera-verify-t${x.t.toFixed(1)}`, { testInfo, compare: false });
  }

  expect(report.samples, 'whole take at 2 Hz').toBeGreaterThanOrEqual(Math.floor(entry.duration * 2));
  expect(report.selfCheck.frameModelMismatch, 'framing/size model identical to the engine evaluator').toBe(0);
  expect(report.selfCheck.groundRay, 'control ray hits the static campus meshes').not.toBeNull();
  expect(report.scene.staticTriangles, 'campus meshes are in the triangle grid').toBeGreaterThan(10_000);
  expect.soft(report.meanReal, 'mean real readability').toBeGreaterThanOrEqual(0.85);
  expect.soft(report.hiddenByRealMesh.samples.map(line), 'planner >= 0.8 but hidden by the real mesh (real <= 0.3)').toEqual([]);
  expect(errors, 'console/page errors').toEqual([]);
});
