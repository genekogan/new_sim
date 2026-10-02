/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

test('classroom links to a live camera view of the selected arrangement', async ({ page, context }) => {
  const errors: string[] = [];
  const requests: string[] = [];
  context.on('page', (p) => {
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('request', (r) => requests.push(r.url()));
  });
  await page.goto('/lab?scenario=classroom-8');
  await expect(page.getByTestId('classroom-hud')).toBeVisible();
  const next = context.waitForEvent('page');
  await page.getByRole('link', { name: 'Open a separate classroom camera review' }).click();
  const camera = await next;
  const frame = camera.frameLocator('iframe');
  // The embedded Lab boots asynchronously (models, hook, then React controls).
  // Use its explicit readiness contract before asserting selected-arrangement UI;
  // neither the 120s journey deadline nor the original 15s assertions change.
  await camera.waitForFunction(() => {
    const embedded = document.querySelector<HTMLIFrameElement>('iframe')?.contentWindow as
      | (Window & { __marsEngine?: { ready: boolean; state(): { scenario: string } } })
      | null;
    return embedded?.__marsEngine?.ready && embedded.__marsEngine.state().scenario === 'classroom-8';
  });
  await expect(frame.getByRole('combobox', { name: 'Scenario' })).toHaveValue('classroom-8');
  await frame.getByRole('button', { name: 'Start session', exact: true }).click();
  await camera.waitForFunction(() => {
    const review = (window as unknown as { __cameraReview?: { report(): { frames: unknown[] } } }).__cameraReview;
    return (review?.report().frames.length ?? 0) > 2;
  });
  await expect(camera.getByRole('checkbox', { name: /Bounded Jev bridge/, includeHidden: true })).toBeDisabled();
  await expect(camera.getByRole('checkbox', { name: /Bounded Jev bridge/, includeHidden: true })).toBeHidden();
  expect(requests.filter((url) => url.startsWith('http://127.0.0.1:7393/'))).toEqual([]);
  expect(errors).toEqual([]);
  const artifacts = path.resolve('e2e/artifacts', process.env.E2E_RUN ?? 'lab-camera-entry');
  mkdirSync(artifacts, { recursive: true });
  await camera.screenshot({ path: path.join(artifacts, 'live-classroom-eight.png') });
});

test('optional camera observes the current paused Lab and disposes before reset', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/lab?scenario=classroom-4');
  await page.waitForFunction(() => (window as unknown as { __marsEngine: { ready: boolean } }).__marsEngine?.ready);
  await page.evaluate(() => {
    const hook = (window as unknown as { __marsEngine: { runScenario(s: string, o: { paused: boolean }): void } }).__marsEngine;
    hook.runScenario('classroom-4', { paused: true });
  });
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  const before = await page.evaluate(() => {
    const hook = (window as unknown as { __marsEngine: { stateHash(): string; state(): { tick: number } } }).__marsEngine;
    return { hash: hook.stateHash(), tick: hook.state().tick };
  });
  await page.getByRole('combobox', { name: 'Live camera', exact: true }).selectOption('clear');
  await page.getByRole('button', { name: 'Follow guest2', exact: true }).click();
  await expect(page.getByText(/^OPERATOR · clear/)).toBeVisible();
  await page.getByRole('button', { name: 'Return camera to auto', exact: true }).click();
  await expect(page.getByText(/^AUTO · clear/)).toBeVisible();
  expect(await page.evaluate(() => {
    const hook = (window as unknown as { __marsEngine: { stateHash(): string; state(): { tick: number } } }).__marsEngine;
    return { hash: hook.stateHash(), tick: hook.state().tick };
  })).toEqual(before);
  const artifacts = path.resolve('e2e/artifacts', process.env.E2E_RUN ?? 'lab-camera-entry');
  mkdirSync(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, 'same-world-live-camera.png') });
  await page.getByRole('combobox', { name: 'Live camera', exact: true }).selectOption('off');
  await expect(page.getByText(/^AUTO · clear/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.getByTestId('classroom-hud')).toContainText('ready');
  expect(errors).toEqual([]);
});

// Preset discovery is a shared engine/camera interface, independent of shot policy.
for (const [scenario, startControl] of [
  ['creative-afternoon', 'Start creative afternoon'],
  ['gallery-tour', 'Start gallery tour'],
  ['reading-circle-rotated', 'Start shared reading'],
  ['seed-planting', 'Start plant A'],
  ['garden-afternoon', 'Start garden afternoon'],
] as const) {
  test(`activity review retains requested ${scenario} and observes the same paused world`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/cinematography/review.html?scenario=${scenario}`);
    await page.waitForFunction((name) => {
      const embedded = document.querySelector<HTMLIFrameElement>('iframe')?.contentWindow as
        | (Window & { __marsEngine?: { ready: boolean; state(): { scenario: string } } }) | null;
      return embedded?.__marsEngine?.ready && embedded.__marsEngine.state().scenario === name;
    }, scenario);
    const frame = page.frameLocator('iframe');
    await expect(frame.getByRole('combobox', { name: 'Scenario', exact: true })).toHaveValue(scenario);
    await frame.getByRole('button', { name: startControl, exact: true }).click();
    await page.waitForFunction(() => ((window as unknown as {
      __cameraReview?: { report(): { frames: unknown[] } }
    }).__cameraReview?.report().frames.length ?? 0) > 2);
    await frame.getByRole('button', { name: 'Pause', exact: true }).click();
    const evidence = await frame.locator('body').evaluate(() => {
      const h = (window as unknown as { __marsEngine: {
        state(): { tick: number; scenario: string }; stateHash(): string; violations(): unknown[]
      } }).__marsEngine;
      return { tick: h.state().tick, scenario: h.state().scenario, hash: h.stateHash(), violations: h.violations() };
    });
    await page.getByRole('button', { name: 'Follow activity person for 6s', exact: true }).click();
    await page.getByRole('button', { name: 'Return to auto', exact: true }).click();
    expect(await frame.locator('body').evaluate(() => {
      const h = (window as unknown as { __marsEngine: {
        state(): { tick: number; scenario: string }; stateHash(): string; violations(): unknown[]
      } }).__marsEngine;
      return { tick: h.state().tick, scenario: h.state().scenario, hash: h.stateHash(), violations: h.violations() };
    })).toEqual(evidence);
    expect(evidence.violations).toEqual([]);
    expect(errors).toEqual([]);
    const artifacts = path.resolve('e2e/artifacts', process.env.E2E_RUN ?? 'lab-camera-entry');
    mkdirSync(artifacts, { recursive: true });
    await page.screenshot({ path: path.join(artifacts, `same-world-review-${scenario}.png`) });
  });
}
