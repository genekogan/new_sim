// LM-009: a parsed fixture hold compiled by the studio's year-direct harness, checked against rendered meshes.
import { test, expect } from '@playwright/test';
import { parseSentence } from '../engine/camera/parse.ts';
import type { CameraVerifyReport } from '../app/studio/camera-verify';
import { captureView, collectConsoleErrors, openStudio, waitFrames, writeArtifact } from './helpers';

type Hook = {
  directOnYear: (d: unknown[], o: { crop: [number, number, number, number]; duration: number }) => Promise<{
    ok: boolean; diagnostics: unknown[]; shots: { t0: number; t1: number }[];
  }>;
  verifyCamera: (from: number, to: number, hz: number, o: { track: 'year' }) => Promise<CameraVerifyReport>;
  look: (position: number[], target: number[]) => void;
};

test('fixture subject: hold on the 2024 sink, verify real visibility and capture the compiled pose', async ({ page }, testInfo) => {
  const errors = collectConsoleErrors(page);
  const parsed = parseSentence('hold on the sink', { fixtures: ['sink'] });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed));
  await openStudio(page, 2024);
  const compiled = await page.evaluate((direction) => (window.__marsStudio as unknown as Hook).directOnYear([direction], { crop: [-30, 15, 35, 70], duration: 30 }), parsed.direction);
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
  await captureView(page, 'camera-fixture-sink', { testInfo, compare: false });
  writeArtifact('camera-fixture-sink.json', { sentence: 'hold on the sink', parsed, compiled, verification });
  expect(errors).toEqual([]);
});
