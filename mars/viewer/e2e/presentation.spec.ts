import { test, expect } from '@playwright/test';
import {
  captureView,
  collectConsoleErrors,
  expectCanvasNotBlank,
  waitReady,
  waitFrames,
} from './helpers';

test('alumni entry: fullscreen controls use the existing live campus', async ({
  page,
}, testInfo) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/');
  await waitReady(page);
  await expectCanvasNotBlank(page);
  await expect(
    page.locator(
      '.studio-header,.studio-sidebar,.studio-evidence,.stage-top,.stage-toolbar',
    ),
  ).toHaveCount(0);
  const box = await page.locator('.studio-viewport').boundingBox();
  expect(box).toEqual({ x: 0, y: 0, width: 1280, height: 800 });
  await expect(
    page.getByRole('checkbox', { name: 'Time', exact: true }),
  ).not.toBeChecked();
  await captureView(page, 'presentation-day', { testInfo, compare: false });
  await page
    .getByLabel('Go inside', { exact: true })
    .selectOption('auditorium');
  await waitFrames(page, 3);
  await captureView(page, 'presentation-auditorium', {
    testInfo,
    compare: false,
  });
  await page.getByRole('button', { name: 'WASD', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'WASD', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowLeft');
  await page.getByRole('button', { name: 'Aerial', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Aerial', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('checkbox', { name: 'Time', exact: true }).check();
  await page.getByLabel('Time of day', { exact: true }).fill('22');
  await expect(
    page.getByRole('checkbox', { name: 'Time', exact: true }),
  ).not.toBeChecked();
  const state = await page.evaluate(() =>
    (
      window.__marsStudio as unknown as {
        atmosphereState: () => { hour: number; cycle: boolean; fire: string };
      }
    ).atmosphereState(),
  );
  expect(state).toEqual({ hour: 22, cycle: false, fire: 'auto' });
  await waitFrames(page, 3);
  await captureView(page, 'presentation-night', { testInfo, compare: false });
  await page.getByRole('button', { name: 'Controls', exact: false }).click();
  await expect(page.getByLabel('Year', { exact: true })).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await waitFrames(page, 3);
  await captureView(page, 'presentation-mobile-collapsed', {
    testInfo,
    compare: false,
  });
  await page.getByRole('button', { name: 'Controls', exact: false }).click();
  await page.getByLabel('Year', { exact: true }).selectOption('2024');
  await expect(page).toHaveURL(/\/\?year=2024$/);
  await waitReady(page);
  expect(await page.evaluate(() => window.__marsStudio?.year)).toBe(2024);
  await expect(
    page.getByRole('checkbox', { name: 'Time', exact: true }),
  ).not.toBeChecked();
  expect(errors).toEqual([]);
});

test('photo entry retains the original reconstruction viewer', async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/photo');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(
    page.getByText('Loading textured mesh…', { exact: true }),
  ).not.toBeVisible({ timeout: 90_000 });
  await expect(
    page.getByText('Reconstruction index unavailable', { exact: true }),
  ).not.toBeVisible();
  await expect(page.locator('.studio-presentation')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test.describe('running presentation life', () => {
  // The shared baseline setting freezes campus life; exercise normal live motion
  // separately so each bounded journey keeps the original120s deadline.
  test.use({ reducedMotion: 'no-preference' });
  test('explicit EUC follow and automatic night atmosphere', async ({
    page,
  }, testInfo) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/');
    await waitReady(page);
    await page.getByRole('button', { name: 'ride EUC', exact: true }).click();
    await expect
      .poll(() => page.locator('canvas').getAttribute('data-camera-mode'))
      .toBe('euc-epicycle');
    await captureView(page, 'presentation-euc', { testInfo, compare: false });
    await page.getByLabel('Time of day', { exact: true }).fill('22');
    await waitFrames(page, 3);
    await captureView(page, 'presentation-live-night', {
      testInfo,
      compare: false,
    });
    const state = await page.evaluate(() =>
      (
        window.__marsStudio as unknown as {
          atmosphereState: () => { hour: number; cycle: boolean; fire: string };
        }
      ).atmosphereState(),
    );
    expect(state).toEqual({ hour: 22, cycle: false, fire: 'auto' });
    // Rider follow leaves walking false: Aerial must explicitly hand back the view.
    await expect(
      page.getByRole('button', { name: 'WASD', exact: true }),
    ).toHaveAttribute('aria-pressed', 'false');
    await expect
      .poll(() => page.locator('canvas').getAttribute('data-rider-position'))
      .toMatch(/^-?\d/);
    await page.getByRole('button', { name: 'Aerial', exact: true }).click();
    await expect
      .poll(() => page.locator('canvas').getAttribute('data-camera-mode'))
      .toBe('free');
    await expect
      .poll(() => page.locator('canvas').getAttribute('data-rider-position'))
      .toBe('');
    await expect(
      page.getByRole('button', { name: 'Aerial', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(errors).toEqual([]);
  });
});
