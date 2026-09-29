import { test, expect } from '@playwright/test';
import { kitchenCameraFile } from '../engine/test/camera-studio-fixtures.ts';
import { captureView, collectConsoleErrors, openStudio, waitFrames, writeArtifact } from './helpers';

test('Say it uses the active file vocabulary, refuses a whole mixed request, and plays a fixture hold without a room', async ({ page }, testInfo) => {
  const errors = collectConsoleErrors(page);
  const file = kitchenCameraFile();
  const entry = { id: file.take.id, label: file.label, file: '/engine/takes/camera-vocab-test.json', year: 2024, hypothetical: true,
    duration: 6, entities: 0, finalStateHash: file.take.finalStateHash, cameraTrack: file.camera.id, moments: {}, violations: 0, blockedWaits: 0, bytes: JSON.stringify(file).length };
  await page.route('**/engine/takes/manifest.json', (r) => r.fulfill({ json: { schema: 'mars-take-manifest/1', takes: [entry] } }));
  await page.route('**/engine/takes/camera-vocab-test.json', (r) => r.fulfill({ json: file }));
  await openStudio(page, 2024);
  await page.getByRole('combobox', { name: 'Replay take' }).selectOption(entry.id);
  await page.locator('.take-direct summary').click();
  const sentence = page.getByRole('textbox', { name: 'Direction sentence' });
  const json = page.getByRole('textbox', { name: 'Directions JSON' });
  await expect(page.getByRole('combobox', { name: 'Subject kind' }).locator('option').filter({ hasText: /^fixture$/ })).toHaveCount(1);
  await sentence.fill('hold on the sink');
  await sentence.press('Enter');
  await expect(page.getByRole('status', { name: 'Sentence parsed' })).toContainText('"kind":"fixture"');
  const directions = JSON.parse(await json.inputValue());
  expect(directions).toEqual([{ subject: { kind: 'fixture', ref: 'sink' }, motion: { verb: 'hold' } }]);
  await sentence.fill('hold on the sink then zoom in');
  await sentence.press('Enter');
  await expect(page.getByRole('alert', { name: 'Sentence refused' })).toContainText('Sentence 2/2:');
  await expect(page.getByRole('alert', { name: 'Sentence refused' })).toContainText('camera.parse.unknown-verb');
  expect(JSON.parse(await json.inputValue()), 'a refused clause appends no directions').toEqual(directions);
  await captureView(page, 'studio-camera-vocab-refused', { testInfo, compare: false });
  await page.getByRole('button', { name: 'Compute camera' }).click();
  await expect(page.getByRole('list', { name: 'Shot list' })).toContainText('sink bowl');
  await page.getByRole('button', { name: 'Play directed track' }).click();
  await page.getByRole('button', { name: 'Pause take' }).click();
  await waitFrames(page, 4);
  await captureView(page, 'studio-camera-vocab-sink', { testInfo, compare: false });
  writeArtifact('studio-camera-vocab.json', { directions, take: entry.id, finalStateHash: entry.finalStateHash });
  expect(errors).toEqual([]);
});
