// Studio "Direct camera" (docs/engineering/STUDIO_REPLAY.md, CAMERA_DIRECT.md): the director builds a typed direction
// with the replay bar's form, the studio compiles it in the browser against the open flagship take (phase 2
// self-correction on), shows the shot list with each correction and its reason, and plays the directed track with the
// engine camera. The direction is a close hold on the first carry crew from the east at 1 s: a bystander walks
// between the lens and the crew, so the compiler must correct it (foreground → raise). A second direction names a
// group nobody is in and must be refused with the compiler's diagnostic. Captures
// artifacts/<run>/studio-direct-{shots,playing}.png.
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { captureView, collectConsoleErrors, openStudio, waitFrames, writeArtifact } from './helpers';

type Info = { id: string; t: number; engineCamera: boolean; playing: boolean; finalStateHash: string; poseHash: string; shot: string; track: { id: string; kind: string; own: boolean } };
type Hook = { take: () => Info | null };
const manifest = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../public/engine/takes/manifest.json'), 'utf8'));
const entry = manifest.takes[0];
const info = (page: Page) => page.evaluate(() => (window.__marsStudio as unknown as Hook).take());

async function scrub(page: Page, t: number) {
  await page.getByRole('slider', { name: 'Take time scrubber' }).fill(String(t));
  await page.waitForFunction((want) => Math.abs(((window.__marsStudio as unknown as Hook).take()?.t ?? -1) - want) < 0.051, t);
  await waitFrames(page, 4);
}

test('direct camera: form → shot list with a correction → play the directed track', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const errors = collectConsoleErrors(page);
  await openStudio(page);
  await page.getByRole('combobox', { name: 'Replay take' }).selectOption(entry.id);
  await page.waitForFunction(() => !!(window.__marsStudio as unknown as Hook).take(), null, { timeout: 60_000 });
  const before = (await info(page))!;
  await scrub(page, 1);

  await page.locator('.take-direct summary').click();
  const form = page.getByRole('group', { name: 'Direction builder' });
  await form.getByRole('combobox', { name: 'Subject kind' }).selectOption('group');
  await form.getByRole('textbox', { name: 'Subject' }).fill('carryA');
  await form.getByRole('combobox', { name: 'Verb' }).selectOption('hold');
  await form.getByRole('combobox', { name: 'Framing' }).selectOption('close');
  await form.getByRole('combobox', { name: 'Side' }).selectOption('east');
  await form.getByRole('button', { name: 'Replace' }).click();
  const json = JSON.parse(await page.getByRole('textbox', { name: 'Directions JSON' }).inputValue());
  expect(json, 'the form writes the typed direction the compiler takes').toEqual([{ subject: { kind: 'group', ref: 'carryA' }, motion: { verb: 'hold' }, at: 1, framing: { size: 'close', side: 'east' } }]);

  await page.getByRole('button', { name: 'Compute camera' }).click();
  const shots = page.getByRole('list', { name: 'Shot list' });
  await expect(shots).toBeVisible({ timeout: 60_000 });
  const corrections = shots.getByRole('list', { name: /^Corrections for / });
  await expect(corrections.first()).toContainText('foreground → raise');
  const text = await shots.innerText();
  await captureView(page, 'studio-direct-shots', { testInfo, compare: false });

  await page.getByRole('button', { name: 'Play directed track' }).click();
  await page.getByRole('button', { name: 'Pause take' }).click();
  const playing = (await info(page))!;
  expect(playing.track.kind, 'the engine camera now follows the directed track').toBe('directed');
  expect(playing.track.own).toBe(false);
  expect(playing.engineCamera).toBe(true);
  await expect(page.locator('.take-direct summary')).toContainText('playing the directed track');
  await scrub(page, 4);
  const at4 = (await info(page))!;
  expect(at4.shot).toMatch(/hold/);
  await captureView(page, 'studio-direct-playing', { testInfo, compare: false });
  expect(at4.finalStateHash, 'directing the camera never changes the take').toBe(before.finalStateHash);

  // back to the take's own camera: the same take time shows identical poses (spec §18)
  await page.locator('.take-direct summary').click(); // the form folds away while the directed track plays
  await page.getByRole('button', { name: "Back to the take's camera" }).click();
  const back = (await info(page))!;
  expect(back.track.own).toBe(true);
  expect(back.poseHash).toBe(at4.poseHash);

  // a group nobody is in → refused with the compiler's diagnostic
  await page.getByRole('textbox', { name: 'Directions JSON' }).fill(JSON.stringify([{ subject: { kind: 'group', ref: 'nobody-here' }, motion: { verb: 'hold' }, at: 1 }]));
  await page.getByRole('button', { name: 'Compute camera' }).click();
  const refused = page.getByRole('alert', { name: 'Direction refused' });
  await expect(refused).toContainText('camera.direct.unknown', { timeout: 60_000 });
  const refusal = await refused.innerText();

  writeArtifact('studio-direct.json', { direction: json, shots: text, playing: { t: playing.t, track: playing.track }, refusal });
  console.log(`studio-direct: ${text.replace(/\n+/g, ' | ')}\n  refused: ${refusal}`);
  expect(errors, 'console/page errors').toEqual([]);
});
