/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
test('checkpoint tour launches real rooms and exposes current interaction and camera entry points', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/lab?scenario=classroom-4');
  const tour = page.getByTestId('checkpoint-tour');
  await expect(tour).toBeVisible();
  await tour.getByRole('button', { name: 'Load 8-guest room' }).click();
  await expect(page.getByRole('combobox', { name: 'Scenario', exact: true })).toHaveValue('classroom-8');
  await expect(tour.getByRole('link', { name: 'Optional live camera review' })).toHaveAttribute('href', '/cinematography/review.html?scenario=classroom-8');
  await tour.locator('summary').click();
  await expect(tour).toContainText('Table helper guest2');
  await expect(tour).toContainText('not a playable world');
  await expect(page.getByRole('button', { name: 'Move empty table to side', exact: true })).toBeVisible();
  await tour.getByRole('button', { name: 'Load 4-guest room' }).click();
  await expect(page.getByRole('combobox', { name: 'Scenario', exact: true })).toHaveValue('classroom-4');
  await expect(tour.getByRole('link', { name: 'Recorded six-scene camera replay' })).toHaveAttribute('href', '/app/camera-lab/suite.html');
  const artifacts = path.resolve('e2e/artifacts', process.env.E2E_RUN ?? 'checkpoint-tour');
  mkdirSync(artifacts, { recursive: true });
  await tour.locator('details').evaluate((el) => { (el as HTMLDetailsElement).open = false; });
  await page.screenshot({ path: path.join(artifacts, 'checkpoint-tour.png') });
  await tour.getByRole('button', { name: 'Load 8-guest room' }).click();
  await tour.getByRole('button', { name: 'Try a continuing day', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Scenario', exact: true })).toHaveValue('work-break-8');
  await expect(page.getByTestId('purposeful-routine-hud')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start purposeful routine', exact: true })).toBeDisabled();
  await expect(tour).toBeVisible();
  // Admission is source-sensitive; current and source-era construction proof are separate.
  await expect(tour).toContainText('build checks the loaded layout before starting');
  await expect(tour).toContainText('missing staging positions and blockers');
  await expect(tour).toContainText('Historical source-era fixtures are separate validation evidence');
  await tour.getByRole('button', { name: 'Try an independent design studio', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Scenario', exact: true })).toHaveValue('design-studio');
  await expect(tour).toContainText('one fixed arrangement');
  await expect(page.getByTestId('workstation-appearance')).toBeVisible();
  await expect(page.getByTestId('lab-camera-controls')).toHaveCount(0);
  await tour.getByRole('button', { name: 'Load 4-guest room', exact: true }).click();
  await expect(page.getByTestId('lab-camera-controls')).toBeVisible();
  await expect(tour).toContainText('Live camera');
  // The tour follows playable rooms without displacing diagnostic controls.
  await page.getByRole('combobox', { name: 'Scenario', exact: true }).selectOption('stairs');
  await expect(tour).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Step', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Scenario', exact: true }).selectOption('work-break-4');
  await expect(tour).toBeVisible();
  expect(errors).toEqual([]);
});
