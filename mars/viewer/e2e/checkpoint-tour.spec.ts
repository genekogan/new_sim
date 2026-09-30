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
  expect(errors).toEqual([]);
});
