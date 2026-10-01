// LM-012: actual browser worker execution, byte-equivalent result, responsive frames and cancellation.
import { test, expect } from '@playwright/test';
import { currentCameraFile, CURRENT_KITCHEN_DIRECTION } from './camera-current-fixture';
import { compileTakeCamera } from '../app/studio/direct-camera-compile.ts';
import { loadCampusYear } from '../engine/campus/history.ts';
import { loadCampusFile } from '../engine/campus/history-node.ts';
import { hashOf } from '../engine/core/hash.ts';
import { captureView, collectConsoleErrors, openStudio, writeArtifact } from './helpers';

type Probe = { started: number; finished: number; terminated: number; frames: number; active: number };
type Hook = { direct: (d: unknown[]) => Promise<{ ok: boolean; trackId: string } | null>; take: () => { track: { id: string } } | null; cameras: () => { id: string; kind: string }[] };

test('file camera worker preserves output, renders frames during compile, and cancels on take close', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  const file = currentCameraFile(2800);
  const directions = [{ ...CURRENT_KITCHEN_DIRECTION, at: 2728.8 }];
  const { base: scene } = loadCampusYear(2024, loadCampusFile(2024));
  const expected = compileTakeCamera({ take: file.take, scene, directions, opts: {} });
  expect(expected.result.ok, JSON.stringify(expected.result)).toBe(true);
  const entry = { id: file.take.id, label: file.label, file: '/engine/takes/camera-worker-test.json', year: 2024, hypothetical: true,
    duration: 2800, entities: 0, finalStateHash: file.take.finalStateHash, cameraTrack: file.camera.id, moments: {}, violations: 0, blockedWaits: 0, bytes: JSON.stringify(file).length };
  await page.route('**/engine/takes/manifest.json', (r) => r.fulfill({ json: { schema: 'mars-take-manifest/1', takes: [entry] } }));
  await page.route('**/engine/takes/camera-worker-test.json', (r) => r.fulfill({ json: file }));
  await page.addInitScript(() => {
    const probe: Probe = { started: 0, finished: 0, terminated: 0, frames: 0, active: 0 };
    Object.assign(window, { cameraWorkerProbe: probe, cameraWorkerResult: null });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      camera: boolean;
      pending = false;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.camera = String(url).includes('direct-camera.worker');
        if (this.camera) this.addEventListener('message', (event) => {
          if (event.data.type === 'started') {
            this.pending = true; probe.active++; probe.started++;
            if ((window as unknown as { cancelOnWorkerStart?: boolean }).cancelOnWorkerStart) {
              const picker = document.querySelector<HTMLSelectElement>('select[aria-label="Replay take"]')!;
              picker.value = '';
              picker.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
          if (event.data.type === 'result') {
            if (this.pending) { this.pending = false; probe.active--; }
            probe.finished++;
            Object.assign(window, { cameraWorkerResult: event.data.compiled });
          }
        });
      }
      terminate() {
        if (this.camera) { probe.terminated++; if (this.pending) { probe.active--; this.pending = false; } }
        super.terminate();
      }
    };
    const frame = () => { if (probe.active) probe.frames++; requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
  });
  await openStudio(page, 2024);
  const picker = page.getByRole('combobox', { name: 'Replay take' });
  await picker.selectOption(entry.id);
  await page.locator('.take-direct summary').click();
  await page.getByRole('textbox', { name: 'Directions JSON' }).fill(JSON.stringify(directions));
  await page.getByRole('button', { name: 'Compute camera' }).click();
  await expect(page.getByRole('list', { name: 'Shot list' })).toContainText('kitchen counter');
  const observation = await page.evaluate(async () => {
    const modulePath = '/engine/core/hash.ts';
    const { hashOf } = await import(/* @vite-ignore */ modulePath);
    const w = window as unknown as { cameraWorkerProbe: Probe; cameraWorkerResult: { result: unknown; track: unknown } };
    return { probe: { ...w.cameraWorkerProbe }, resultHash: hashOf(w.cameraWorkerResult.result), trackHash: hashOf(w.cameraWorkerResult.track) };
  });
  expect(observation.resultHash).toBe(hashOf(expected.result));
  expect(observation.trackHash).toBe(hashOf(expected.track));
  expect(observation.probe.started).toBe(1);
  expect(observation.probe.finished).toBe(1);
  expect(observation.probe.terminated).toBe(1);
  expect(observation.probe.frames, 'UI frames after worker compile starts and before result arrives').toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Play directed track' }).click();
  await page.getByRole('button', { name: 'Pause take' }).click();
  await captureView(page, 'camera-worker-current-counter', { testInfo, compare: false });

  // Start another real request, close the take after the worker has entered compilation, and await cancellation.
  await page.evaluate((d) => {
    Object.assign(window, { cancelOnWorkerStart: true });
    Object.assign(window, { pendingCamera: (window.__marsStudio as unknown as Hook).direct(d) });
  }, directions);
  const cancelled = await page.evaluate(async () => {
    const result = await (window as unknown as { pendingCamera: Promise<unknown> }).pendingCamera;
    return { result, probe: (window as unknown as { cameraWorkerProbe: Probe }).cameraWorkerProbe, take: (window.__marsStudio as unknown as Hook).take() };
  });
  expect(cancelled.result).toBeNull();
  expect(cancelled.take).toBeNull();
  expect(cancelled.probe.terminated).toBe(2);
  expect(cancelled.probe.active).toBe(0);
  writeArtifact('camera-worker.json', { observation, cancelled });
  expect(errors).toEqual([]);
});
