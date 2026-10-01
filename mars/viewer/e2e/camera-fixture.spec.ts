// LM-009: a parsed fixture route compiled by the studio's year-direct harness, checked against rendered meshes.
import { test, expect } from '@playwright/test';
import { CURRENT_COUNTER, CURRENT_KITCHEN_DIRECTION } from './camera-current-fixture';
import { parseSentence } from '../engine/camera/parse.ts';
import type { CameraVerifyReport } from '../app/studio/camera-verify';
import { captureView, collectConsoleErrors, openStudio, waitFrames, writeArtifact } from './helpers';

type Hook = {
  directOnYear: (d: unknown[], o: { crop?: [number, number, number, number]; duration: number }) => Promise<{
    ok: boolean; diagnostics: unknown[]; shots: { t0: number; t1: number }[];
  }>;
  verifyCamera: (from: number, to: number, hz: number, o: { track: 'year' }) => Promise<CameraVerifyReport>;
  look: (position: number[], target: number[]) => void;
};

test('fixture subject: route to the current 2024 counter, verify real visibility and capture the compiled pose', async ({ page }, testInfo) => {
  const errors = collectConsoleErrors(page);
  const parsed = parseSentence(`fly through ${CURRENT_COUNTER}`, { fixtures: [CURRENT_COUNTER] });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed));
  expect(parsed.direction.subject).toEqual(CURRENT_KITCHEN_DIRECTION.subject);
  const direction = { ...parsed.direction, motion: CURRENT_KITCHEN_DIRECTION.motion, context: CURRENT_KITCHEN_DIRECTION.context, duration: CURRENT_KITCHEN_DIRECTION.duration };
  await openStudio(page, 2024);
  const compiled = await page.evaluate((direction) => (window.__marsStudio as unknown as Hook).directOnYear([direction], { duration: 30 }), direction);
  expect(compiled.ok, JSON.stringify(compiled.diagnostics)).toBe(true);
  const shot = compiled.shots[0];
  const verification = await page.evaluate(([from, to]) => (window.__marsStudio as unknown as Hook).verifyCamera(from, to, 2, { track: 'year' }), [shot.t0, shot.t1]);
  expect(verification.samples).toBeGreaterThan(0);
  expect(verification.selfCheck.frameModelMismatch).toBe(0);
  expect(verification.hiddenByRealMesh.count).toBe(0);
  const sample = verification.worst[0];
  expect(sample).toBeDefined();
  await page.evaluate(({ camera, target }) => (window.__marsStudio as unknown as Hook).look(camera, target), sample);
  await waitFrames(page, 4);
  await captureView(page, 'camera-fixture-current-counter', { testInfo, compare: false });
  // Keep the worst-disagreement capture above; separately inspect the actual countertop-facing phase.
  // Current occupied geometry frames the countertop during 12–14 s. The old
  // 15 s single-point check lies in the later turn away (2/5 points framed).
  // Verify the entire observed facing interval, retaining the 60% visibility limit.
  const interval = await page.evaluate(() => (window.__marsStudio as unknown as Hook).verifyCamera(12, 14, 2, { track: 'year' }));
  expect(interval.samples).toBe(5);
  expect(interval.all.every(sample => sample[2] >= 0.6), 'counter visible throughout its facing interval').toBe(true);
  const facing = await page.evaluate(() => (window.__marsStudio as unknown as Hook).verifyCamera(13, 13, 2, { track: 'year' }));
  expect(facing.samples).toBe(1);
  expect(facing.meanReal, 'current countertop visible during the turn toward it').toBeGreaterThanOrEqual(0.6);
  const pose = facing.worst[0];
  await page.evaluate(({ camera, target }) => (window.__marsStudio as unknown as Hook).look(camera, target), pose);
  await waitFrames(page, 4);
  await captureView(page, 'camera-fixture-current-counter-facing', { testInfo, compare: false });
  writeArtifact('camera-fixture-current-counter.json', { sentence: `fly through ${CURRENT_COUNTER}`, parsed, direction, compiled, verification, interval, facing });
  expect(errors).toEqual([]);
});

// The current museum deliberately has no source-backed sink; no old scene is injected into this world.
test('current 2024 camera refuses the removed sink and an occluded automatic counter hold', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await openStudio(page, 2024);
  const missing = await page.evaluate(() => (window.__marsStudio as unknown as Hook).directOnYear([{ subject: { kind: 'fixture', ref: 'sink' }, motion: { verb: 'hold' } }], { duration: 6 }));
  expect(missing.ok).toBe(false);
  expect(missing.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'camera.direct.unknown', message: expect.stringContaining("no fixture named 'sink'") })]));
  const occluded = await page.evaluate(() => (window.__marsStudio as unknown as Hook).directOnYear([{ subject: { kind: 'fixture', ref: 'chiba-kitchen-kitchen-counter-f36f13fb' }, motion: { verb: 'hold' } }], { duration: 6 }));
  expect(occluded.ok).toBe(false);
  expect(occluded.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'camera.direct.uncorrectable', message: expect.stringContaining('occluded') })]));
  expect(errors).toEqual([]);
});
