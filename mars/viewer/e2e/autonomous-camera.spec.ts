import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { EngineHook } from '../app/lab/hook.ts';
import type { attachLabCamera } from '../cinematography/lab-driver.ts';
declare global {
  interface Window {
    __cameraSuite: {
      ready: boolean;
      play: () => void;
      seek: (time: number) => void;
      state: () => { time: number; index: number; playing: boolean };
      dispose: () => void;
    };
    __marsEngine: EngineHook;
    __cameraReview: ReturnType<typeof attachLabCamera>;
  }
}
const artifacts = path.resolve(
  'e2e/artifacts',
  process.env.E2E_RUN ?? 'codex-autonomous-camera-e2e',
);
test('varied replay suite starts safely and renders every scenario with sustained policy views', async ({
  page,
}) => {
  test.setTimeout(90000);
  const prepare = 'deploy/prepare-camera-demo.mjs';
  execFileSync(
    process.execPath,
    [existsSync(prepare) ? prepare : 'cinematography/suite-record.ts'],
    {
      timeout: 60000,
      stdio: 'pipe',
    },
  );
  // Standalone camera branches predate the owner's production build generator.
  if (!existsSync(prepare)) {
    mkdirSync('public/camera-demo', { recursive: true });
    copyFileSync(
      'e2e/artifacts/codex-autonomous-camera-suite/suite.json',
      'public/camera-demo/suite.json',
    );
  }
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/app/camera-lab/suite.html');
  await page.waitForFunction(() => window.__cameraSuite?.ready);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(100);
  expect(
    await page.evaluate(() => window.__cameraSuite.state().time),
  ).toBeGreaterThanOrEqual(0);
  for (let i = 0; i < 6; i++) {
    await page.evaluate((i) => window.__cameraSuite.seek(i * 15 + 0.1), i);
    await expect(page.locator('#title')).toContainText('REPLAY');
    expect(await page.evaluate(() => window.__cameraSuite.state().index)).toBe(
      i,
    );
  }
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(120);
  expect(await page.evaluate(() => window.__cameraSuite.state().playing)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const paused = await page.evaluate(() => window.__cameraSuite.state().time);
  await page.waitForTimeout(120);
  expect(await page.evaluate(() => window.__cameraSuite.state().time)).toBe(
    paused,
  );
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  expect(
    await page.evaluate(() => window.__cameraSuite.state().time),
  ).toBeLessThan(1);
  await page
    .getByRole('combobox', { name: 'Replay scenario' })
    .selectOption('workstation');
  await expect(page.locator('#title')).toContainText('workstation');
  expect(await page.evaluate(() => window.__cameraSuite.state().playing)).toBe(
    false,
  );
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(120);
  expect(
    await page.evaluate(() => window.__cameraSuite.state().time),
  ).toBeGreaterThan(0);
  await page.screenshot({
    path: path.join(artifacts, 'production-tour-controls.png'),
  });
  expect(errors).toEqual([]);
  await page.evaluate(() => window.__cameraSuite.dispose());
});
test('review entry honors classroom-8 and keeps Jev local-only', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/cinematography/review.html?scenario=classroom-8');
  await page.waitForFunction(
    () => window.__cameraReview?.report().frames.length > 0,
  );
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    '/lab?scenario=classroom-8',
  );
  await expect(page.locator('#jev')).toBeDisabled();
  await expect(page.locator('#jev-control')).toBeHidden();
  await page
    .getByRole('combobox', { name: 'Camera policy' })
    .selectOption('continuous');
  await page.waitForFunction(
    () =>
      window.__cameraReview?.report().policy === 'continuous' &&
      window.__cameraReview.report().frames.length > 0,
  );
  await expect(page.locator('small')).toContainText(
    'observational camera prototype',
  );
  expect(
    await page.evaluate(
      () =>
        window.__cameraReview.report().observations.at(-1)?.activity.members
          .length,
    ),
  ).toBeGreaterThan(4);
  expect(errors).toEqual([]);
});
test('live coverage, manual precedence, asynchronous failure and cleanup preserve the world', async ({
  page,
}) => {
  mkdirSync(artifacts, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/lab?scenario=classroom-4');
  await page.waitForFunction(() => window.__marsEngine?.ready);
  await page.evaluate(() =>
    window.__marsEngine.runScenario('classroom-4', { paused: true }),
  );
  await page
    .getByRole('button', { name: 'Start session', exact: true })
    .click();
  await page.evaluate(() => {
    for (
      let i = 0;
      i < 2400 &&
      window.__marsEngine.classroom().session?.phase !== 'presenting';
      i++
    )
      window.__marsEngine.step();
  });
  const hash = await page.evaluate(() => window.__marsEngine.stateHash());
  await page.evaluate(async () => {
    const { attachLabCamera } = await import('/cinematography/lab-driver.ts');
    window.__cameraReview = attachLabCamera(window.__marsEngine, 'clear', {
      choose: async () => {
        throw Error('MOCK network failure');
      },
    });
  });
  await page.waitForFunction(
    () => window.__cameraReview.report().frames.length > 0,
  );
  expect(await page.evaluate(() => window.__marsEngine.stateHash())).toBe(hash);
  await page.waitForFunction(
    () => window.__cameraReview.report().advisory!.failures > 0,
  );
  await page.evaluate(() => {
    window.__cameraReview.takeover('guest2', 2);
  });
  await page.waitForFunction(() =>
    window.__cameraReview
      .report()
      .decisions.some((d) => d.source === 'operator'),
  );
  expect(await page.evaluate(() => window.__marsEngine.stateHash())).toBe(hash);
  await page.screenshot({ path: path.join(artifacts, 'manual-subject.png') });
  await page.evaluate(() => window.__cameraReview.release());
  await page.waitForFunction(
    () => window.__cameraReview.report().decisions.at(-1)?.source === 'local',
  );
  expect(await page.evaluate(() => window.__marsEngine.stateHash())).toBe(hash);
  await page.evaluate(() => window.__cameraReview.takeover('guest2', 2));
  await page.waitForFunction(
    () =>
      window.__cameraReview.report().decisions.at(-1)?.source === 'operator',
  );
  await page.evaluate(() => window.__marsEngine.step(50));
  await page.waitForFunction(
    () => window.__cameraReview.report().decisions.at(-1)?.source === 'local',
  );
  await page.getByRole('button', { name: 'Ask question', exact: true }).click();
  await page.evaluate(() => window.__marsEngine.step(100));
  await page.waitForFunction(() =>
    window.__cameraReview.report().frames.at(-1)?.shot?.includes('guest1'),
  );
  await page.screenshot({ path: path.join(artifacts, 'questioner.png') });
  // Above the mobile breakpoint, the side HUD leaves a genuinely portrait canvas.
  await page.setViewportSize({ width: 900, height: 1100 });
  await page.waitForFunction(
    () => window.__cameraReview.report().observations.at(-1)?.aspect! < 1,
    undefined,
    { timeout: 10000 },
  );
  expect(
    await page.evaluate(
      () => window.__cameraReview.report().frames.at(-1)?.pose,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: path.join(artifacts, 'portrait-questioner.png'),
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForFunction(
    () => window.__cameraReview.report().observations.at(-1)?.aspect! > 1,
  );
  const report = await page.evaluate(() => window.__cameraReview.report());
  expect(report.frames.length).toBeGreaterThan(2);
  expect(report.diagnostics).toEqual([]);
  expect(errors).toEqual([]);
  const beforeDrag = await page.evaluate(() =>
    window.__marsEngine.cameraPose(),
  );
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width * 0.5 + 40,
    box!.y + box!.height * 0.5 + 10,
    { steps: 8 },
  );
  await page.mouse.up();
  const dragged = await page.evaluate(() => window.__marsEngine.cameraPose());
  expect(dragged.position).not.toEqual(beforeDrag.position);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__marsEngine.cameraPose())).toEqual(
    dragged,
  );
  await page.screenshot({ path: path.join(artifacts, 'manual-drag.png') });
  // A paused reset can return to the exact same tick. Epoch, not tick alone,
  // must invalidate decisions, overrides and replay frames.
  await page.evaluate(() =>
    window.__marsEngine.runScenario('classroom-4', { paused: true }),
  );
  await page.waitForFunction(
    () => window.__cameraReview.report().frames.at(-1)?.time === 0,
  );
  const resetSession = await page.evaluate(
    () => window.__cameraReview.report().session,
  );
  await page.evaluate(() =>
    window.__marsEngine.runScenario('classroom-4', { paused: true }),
  );
  await page.waitForFunction(
    (previous) => window.__cameraReview.report().session !== previous,
    resetSession,
  );
  const resetReport = await page.evaluate(() => window.__cameraReview.report());
  expect(resetReport.frames.every((f) => f.time === 0)).toBe(true);
  expect(
    resetReport.decisions.every((d) => d.session === resetReport.session),
  ).toBe(true);
  expect(resetReport.furniture).toBe('live effective geometry');
  const count = await page.evaluate(
    () => window.__cameraReview.report().frames.length,
  );
  await page.evaluate(() => {
    window.__cameraReview.dispose();
    window.__marsEngine.step(2);
  });
  await page.waitForTimeout(200);
  expect(
    await page.evaluate(() => window.__cameraReview.report().frames.length),
  ).toBe(count);
  writeFileSync(
    path.join(artifacts, 'proof.json'),
    JSON.stringify({ hash, report, errors }, null, 2),
  );
});
