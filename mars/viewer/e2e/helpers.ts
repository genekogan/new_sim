// Reusable Playwright helpers for Mars Studio scenarios (see e2e/README.md).
import { expect, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export const E2E_DIR = import.meta.dirname;
export const BASELINES = path.join(E2E_DIR, 'baselines');
export const RUN = process.env.E2E_RUN || 'manual';
export const ARTIFACTS = path.join(E2E_DIR, 'artifacts', RUN);
export const UPDATE_BASELINES = process.env.E2E_UPDATE_BASELINES === '1';

/** Tolerances for SwiftShader WebGL: per-pixel YIQ threshold and share of differing pixels. */
export const DIFF = { threshold: 0.2, maxDiffPixelRatio: 0.015 };

/** Shape of the `window.__marsStudio` hook installed by app/studio/page.tsx. */
export type StudioHook = {
  year: number;
  frames: number;
  ready: boolean;
  info: () => {
    calls: number;
    triangles: number;
    points: number;
    lines: number;
    frame: number;
    geometries: number;
    textures: number;
    pixelRatio: number;
  };
  look: (position: number[], target: number[]) => void;
};
declare global {
  interface Window {
    __marsStudio?: StudioHook;
  }
}

export function studioPath(year?: number) {
  return !year || year === 2026 ? '/studio' : `/studio/${year}`;
}

/**
 * Start collecting console errors and uncaught page errors. Call before
 * navigation; inspect or assert the returned array at the end of the test.
 */
export function collectConsoleErrors(page: Page, ignore: RegExp[] = []) {
  const errors: string[] = [];
  const keep = (text: string) => !ignore.some((re) => re.test(text));
  page.on('console', (m) => {
    if (m.type() === 'error' && keep(m.text())) errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => {
    if (keep(e.message)) errors.push(`pageerror: ${e.message}`);
  });
  page.on('requestfailed', (r) => {
    const reason = r.failure()?.errorText ?? '';
    // Aborted requests are normal (navigation, AbortController on unmount).
    if (!/ERR_ABORTED/.test(reason) && keep(r.url())) errors.push(`requestfailed: ${r.url()} ${reason}`);
  });
  return errors;
}

/**
 * Wait until the studio scene is loaded and at least `frames` frames were
 * rendered after it (driven by the `__marsStudio` hook, no fixed sleeps).
 * `settle` also waits for the adaptive pixel-ratio check (first 5 s budget
 * window) so screenshots are taken at the final render resolution.
 */
export async function waitReady(page: Page, { frames = 3, settle = true, timeout = 90_000 } = {}) {
  await page.waitForFunction(() => window.__marsStudio?.ready === true, null, { timeout });
  if (settle) {
    await page.waitForFunction(
      () => !!document.querySelector<HTMLCanvasElement>('.studio canvas')?.dataset.pixelRatio,
      null,
      { timeout },
    );
  }
  // Photo-evidence thumbnails etc.: no pending requests, visible images decoded.
  await page.waitForLoadState('networkidle', { timeout });
  await page.waitForFunction(
    () =>
      [...document.images]
        .filter((img) => {
          const r = img.getBoundingClientRect();
          return r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
        })
        .every((img) => img.complete),
    null,
    { timeout },
  );
  await waitFrames(page, frames);
  await expect(page.getByRole('status').filter({ hasText: 'Loading' })).toHaveCount(0);
}

/** Wait for `n` more rendered frames. */
export async function waitFrames(page: Page, n = 3) {
  const start = await page.evaluate(() => window.__marsStudio?.frames ?? 0);
  await page.waitForFunction((target) => (window.__marsStudio?.frames ?? 0) >= target, start + n);
}

/** Navigate to /studio or /studio/<year> and wait until the scene is ready. */
export async function openStudio(page: Page, year?: number) {
  await page.goto(studioPath(year));
  await waitReady(page);
  expect(await page.evaluate(() => window.__marsStudio?.year)).toBe(year ?? 2026);
}

/** Put the orbit camera at `position` looking at `target` (scene metres), then render. */
export async function lookAt(page: Page, position: number[], target: number[]) {
  await page.evaluate(([p, t]) => window.__marsStudio!.look(p, t), [position, target]);
  await waitFrames(page, 3);
}

export type CaptureResult = { file: string; baseline: string; diffRatio: number | null; updated: boolean };

/**
 * Screenshot the page into artifacts/<run>/<name>.png and compare it with
 * baselines/<name>.png using a tolerant pixelmatch diff. A diff image is written
 * next to the capture when pixels differ. E2E_UPDATE_BASELINES=1 (or
 * `npm run e2e:update-baselines`) rewrites the baseline instead of comparing.
 * Pass `compare: false` to capture without a baseline (exploratory shots).
 */
export async function captureView(
  page: Page,
  name: string,
  { compare = true, testInfo }: { compare?: boolean; testInfo?: TestInfo } = {},
): Promise<CaptureResult> {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const file = path.join(ARTIFACTS, `${name}.png`);
  const baseline = path.join(BASELINES, `${name}.png`);
  const shot = await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
  await testInfo?.attach(name, { path: file, contentType: 'image/png' });
  if (!compare) return { file, baseline, diffRatio: null, updated: false };
  if (UPDATE_BASELINES) {
    fs.mkdirSync(BASELINES, { recursive: true });
    fs.writeFileSync(baseline, shot);
    return { file, baseline, diffRatio: null, updated: true };
  }
  if (!fs.existsSync(baseline)) {
    throw new Error(`Missing baseline ${path.relative(E2E_DIR, baseline)}; run npm run e2e:update-baselines`);
  }
  const actual = PNG.sync.read(shot);
  const expected = PNG.sync.read(fs.readFileSync(baseline));
  expect(`${actual.width}x${actual.height}`, `${name} size`).toBe(`${expected.width}x${expected.height}`);
  const diff = new PNG({ width: actual.width, height: actual.height });
  const pixels = pixelmatch(actual.data, expected.data, diff.data, actual.width, actual.height, {
    threshold: DIFF.threshold,
  });
  const diffRatio = pixels / (actual.width * actual.height);
  if (pixels > 0) fs.writeFileSync(path.join(ARTIFACTS, `${name}.diff.png`), PNG.sync.write(diff));
  expect(diffRatio, `${name}: ${(diffRatio * 100).toFixed(2)}% pixels differ from baseline`).toBeLessThanOrEqual(
    DIFF.maxDiffPixelRatio,
  );
  return { file, baseline, diffRatio, updated: false };
}

/** Fail if the WebGL canvas is blank (a single flat colour, e.g. context never drew). */
export async function expectCanvasNotBlank(page: Page) {
  const canvas = page.locator('.studio canvas');
  const png = PNG.sync.read(await canvas.screenshot());
  const colours = new Set<number>();
  for (let i = 0; i < png.data.length && colours.size < 64; i += 4 * 97) {
    colours.add((png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2]);
  }
  expect(colours.size, 'distinct colours sampled from the WebGL canvas').toBeGreaterThan(16);
}

/** renderer.info plus JS heap (Chromium-only performance.memory). */
export async function readPerf(page: Page) {
  return page.evaluate(() => {
    const memory = (performance as Performance & { memory?: Record<string, number> }).memory;
    return {
      renderer: window.__marsStudio!.info(),
      heap: memory
        ? {
            usedJSHeapSize: memory.usedJSHeapSize,
            totalJSHeapSize: memory.totalJSHeapSize,
            jsHeapSizeLimit: memory.jsHeapSizeLimit,
          }
        : null,
    };
  });
}

export function writeArtifact(name: string, data: unknown) {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const file = path.join(ARTIFACTS, name);
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n');
  return file;
}

/**
 * A context that records a .webm of everything it renders into
 * artifacts/<run>/video/<name>/. The video is finalised when the context
 * closes. Example:
 *
 *   test('walk tour', async ({ browser }) => {
 *     const context = await recordVideo(browser, 'walk-tour');
 *     const page = await context.newPage();
 *     await openStudio(page, 2026);
 *     await page.getByRole('button', { name: 'Walk · WASD' }).click();
 *     await page.keyboard.down('w'); await waitFrames(page, 60); await page.keyboard.up('w');
 *     await context.close(); // flushes the .webm
 *   });
 */
export async function recordVideo(browser: Browser, name: string, size = { width: 1280, height: 800 }): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: `http://127.0.0.1:${process.env.E2E_VITE_PORT || 5391}`,
    viewport: size,
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    recordVideo: { dir: path.join(ARTIFACTS, 'video', name), size },
  });
}
