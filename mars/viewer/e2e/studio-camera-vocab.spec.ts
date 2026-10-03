import { test, expect } from '@playwright/test';
import { currentCameraFile, CURRENT_COUNTER, CURRENT_KITCHEN_DIRECTION } from './camera-current-fixture.ts';
import { captureView, collectConsoleErrors, openStudio, waitFrames, writeArtifact } from './helpers';

test('Say it uses the active file vocabulary, refuses a whole mixed request, and distinguishes refused hold from supported fixture travel without a room', async ({ page }, testInfo) => {
  const errors = collectConsoleErrors(page);
  const duration = 30;
  const file = currentCameraFile(duration);
  const entry = { id: file.take.id, label: file.label, file: '/engine/takes/camera-vocab-test.json', year: 2024, hypothetical: true,
    duration, entities: 0, finalStateHash: file.take.finalStateHash, cameraTrack: file.camera.id, moments: {}, violations: 0, blockedWaits: 0, bytes: JSON.stringify(file).length };
  await page.route('**/engine/takes/manifest.json', (r) => r.fulfill({ json: { schema: 'mars-take-manifest/1', takes: [entry] } }));
  await page.route('**/engine/takes/camera-vocab-test.json', (r) => r.fulfill({ json: file }));
  await openStudio(page, 2024);
  await page.getByRole('combobox', { name: 'Replay take' }).selectOption(entry.id);
  await page.locator('.take-direct summary').click();
  const sentence = page.getByRole('textbox', { name: 'Direction sentence' });
  const json = page.getByRole('textbox', { name: 'Directions JSON' });
  await expect(page.getByRole('combobox', { name: 'Subject kind' }).locator('option').filter({ hasText: /^fixture$/ })).toHaveCount(1);
  await sentence.fill(`hold on the ${CURRENT_COUNTER}`);
  await sentence.press('Enter');
  await expect(page.getByRole('status', { name: 'Sentence parsed' })).toContainText('"kind":"fixture"');
  const directions = JSON.parse(await json.inputValue());
  expect(directions).toEqual([{ subject: { kind: 'fixture', ref: CURRENT_COUNTER }, motion: { verb: 'hold' } }]);
  await sentence.fill(`hold on the ${CURRENT_COUNTER} then zoom in`);
  await sentence.press('Enter');
  await expect(page.getByRole('alert', { name: 'Sentence refused' })).toContainText('Sentence 2/2:');
  await expect(page.getByRole('alert', { name: 'Sentence refused' })).toContainText('camera.parse.unknown-verb');
  expect(JSON.parse(await json.inputValue()), 'a refused clause appends no directions').toEqual(directions);
  await captureView(page, 'studio-camera-vocab-refused', { testInfo, compare: false });
  await page.getByRole('button', { name: 'Compute camera' }).click();
  // The current counter is a valid fixture, but this automatic hold is occluded.
  // Preserve the readable-shot requirement; an explicitly supported approach may play.
  await expect(page.getByRole('alert', { name: 'Direction refused' })).toContainText('camera.direct.uncorrectable');
  expect(JSON.parse(await json.inputValue()), 'planning refusal retains requested directions').toEqual(directions);
  await json.fill(JSON.stringify([CURRENT_KITCHEN_DIRECTION]));
  await page.getByRole('button', { name: 'Compute camera' }).click();
  await expect(page.getByRole('list', { name: 'Shot list' })).toContainText('kitchen counter');
  await page.getByRole('button', { name: 'Play directed track' }).click();
  await page.getByRole('button', { name: 'Pause take' }).click();
  await page.getByRole('slider', { name: 'Take time scrubber' }).fill('15');
  await waitFrames(page, 4);
  await captureView(page, 'studio-camera-vocab-current-counter', { testInfo, compare: false });
  writeArtifact('studio-camera-vocab.json', { parsedDirections: directions, playedDirections: [CURRENT_KITCHEN_DIRECTION], automaticHold: 'camera.direct.uncorrectable', take: entry.id, finalStateHash: entry.finalStateHash });
  expect(errors).toEqual([]);
});
