// Studio "Direct camera" (docs/engineering/STUDIO_REPLAY.md, CAMERA_DIRECT.md): the director builds a typed direction
// with the replay bar's form, the studio compiles it in the browser against the open flagship take (phase 2
// self-correction on), shows the shot list with each correction and its reason, and plays the directed track with the
// engine camera. The direction is a close hold on the first carry crew from the south (world +X; sun.ts site bearing,
// −X north — this was 'east' under the old −Z-north assumption, same camera side) at 1 s: a bystander walks
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
  await form.getByRole('combobox', { name: 'Side' }).selectOption('south');
  await form.getByRole('button', { name: 'Replace' }).click();
  const json = JSON.parse(await page.getByRole('textbox', { name: 'Directions JSON' }).inputValue());
  expect(json, 'the form writes the typed direction the compiler takes').toEqual([{ subject: { kind: 'group', ref: 'carryA' }, motion: { verb: 'hold' }, at: 1, framing: { size: 'close', side: 'south' } }]);

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

// Take files carry extra camera tracks (CAMERA_DIRECT.md §8.2). "Save track" writes the directed track into the open
// take's file (`withFileCamera`) and offers it as a download; served in place of the shipped file, the replay bar's
// camera picker lists it beside the planned track, plays it like the planned one and verifyCamera takes it by id.
test('save track: directed track → take file with `cameras` → picker lists and plays it → verify by file id', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  type VHook = Hook & {
    cameras: () => { id: string; kind: string; label: string; own: boolean; saved: boolean }[];
    verifyCamera: (fromT?: number, toT?: number, hz?: number, o?: { track?: 'take' | 'directed' | { file: string } }) => Promise<{ track: string | null; samples: number; all: number[][] } | null>;
  };
  const errors = collectConsoleErrors(page);
  const shipped = fs.readFileSync(path.resolve(import.meta.dirname, '../public', entry.file.replace(/^\//, '')), 'utf8');
  await openStudio(page);
  const picker = page.getByRole('combobox', { name: 'Replay take' });
  await picker.selectOption(entry.id);
  await page.waitForFunction(() => !!(window.__marsStudio as unknown as Hook).take(), null, { timeout: 60_000 });
  const camera = page.getByRole('combobox', { name: 'Camera track' });
  await expect(camera.locator('option')).toHaveCount(1); // the shipped file carries only its planned track
  await expect(camera.locator('option').first()).toContainText(`planned · ${entry.cameraTrack}`);

  await page.locator('.take-direct summary').click();
  const direction = [{ subject: { kind: 'group', ref: 'carryA' }, motion: { verb: 'hold' }, at: 1, framing: { size: 'close', side: 'south' } }];
  await page.getByRole('textbox', { name: 'Directions JSON' }).fill(JSON.stringify(direction));
  await page.getByRole('button', { name: 'Compute camera' }).click();
  await expect(page.getByRole('list', { name: 'Shot list' })).toBeVisible({ timeout: 60_000 });
  const listed = await page.evaluate(() => (window.__marsStudio as unknown as VHook).cameras());
  expect(listed.map((c) => [c.kind, c.saved])).toEqual([['planned-shot-list', true], ['directed', false]]);
  const trackId = listed[1].id;
  await expect(camera.locator('option')).toHaveCount(2);
  await expect(camera.locator('option').nth(1)).toHaveText(new RegExp(`^directed · ${trackId} · \\d+ shots? · unsaved$`));
  const inPage = (await page.evaluate(() => (window.__marsStudio as unknown as VHook).verifyCamera(1, 5, 2, { track: 'directed' })))!;

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save track' }).click()]);
  expect(download.suggestedFilename()).toBe(path.basename(entry.file));
  const out = path.join(import.meta.dirname, 'artifacts', process.env.E2E_RUN ?? 'manual', `saved-${path.basename(entry.file)}`);
  await download.saveAs(out);
  const saved = JSON.parse(fs.readFileSync(out, 'utf8'));
  expect(Object.keys(saved.cameras), 'the file carries the directed track under its id').toEqual([trackId]);
  expect(saved.cameras[trackId]).toMatchObject({ id: trackId, takeId: entry.id, kind: 'directed', data: { schema: 'mars-camera-track/1' } });
  const { cameras: _c, ...rest } = saved;
  expect(JSON.stringify(rest) === shipped, 'take, planned camera and everything else byte-identical to the shipped file').toBe(true);
  await expect(page.getByRole('status', { name: 'Saved track' })).toContainText('Not posted to a room');
  await expect(camera.locator('option').nth(1)).not.toContainText('unsaved');

  // serve the saved file as the take and reopen: the picker reads the track from the file
  await page.route(`**${entry.file}`, (r) => r.fulfill({ path: out, contentType: 'application/json' }));
  await picker.selectOption('');
  await picker.selectOption(entry.id);
  await page.waitForFunction(() => !!(window.__marsStudio as unknown as Hook).take(), null, { timeout: 60_000 });
  const reopened = await page.evaluate(() => (window.__marsStudio as unknown as VHook).cameras());
  expect(reopened.map((c) => [c.id, c.saved])).toEqual([[entry.cameraTrack, true], [trackId, true]]);
  await camera.selectOption(trackId);
  const playing = (await info(page))!;
  expect(playing.track).toEqual({ id: trackId, kind: 'directed', own: false });
  expect(playing.t, 'a directed file track starts at its first shot').toBeCloseTo(saved.cameras[trackId].data.shots[0].t0, 5);
  await scrub(page, 4);
  await captureView(page, 'studio-direct-file-track', { testInfo, compare: false });
  const fromFile = (await page.evaluate((id) => (window.__marsStudio as unknown as VHook).verifyCamera(1, 5, 2, { track: { file: id } }), trackId))!;
  expect(fromFile.track).toBe(trackId);
  expect(fromFile.samples).toBeGreaterThan(0);
  expect(fromFile.all, 'the file track verifies exactly as the in-page directed track').toEqual(inPage.all);
  await camera.selectOption(entry.cameraTrack);
  expect((await info(page))!.track.own).toBe(true);

  writeArtifact('studio-direct-save.json', { trackId, bytes: fs.statSync(out).size, shippedBytes: shipped.length, verify: { samples: fromFile.samples, all: fromFile.all } });
  expect(errors, 'console/page errors').toEqual([]);
});
