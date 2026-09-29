// Direct camera from sentences (W48; STUDIO_REPLAY.md §3 "Sentences", CAMERA_DIRECT.md §1, Codex's engine/camera/parse.ts):
// on the flagship take, Gene's four sentences go through the panel's "Say it" box. The three stated ones become the
// typed directions of CAMERA_DIRECT.md's table and are appended to the JSON list; "look at this crowd of people having
// this activity" is refused (deictic) with its question and nothing is appended. An ambiguous word shows its
// candidates; "… then …" appends two directions. The lead's sentence ("do a 270° revolution around the rack bay over 2
// minutes") is then computed and played. Every parsed sentence is also compiled against the take (report only: whether
// the compiler finds the named subject in this take's scene is not the parser's business).
// Captures artifacts/<run>/studio-direct-sentences-{refused,orbit}.png.
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { captureView, collectConsoleErrors, openStudio, waitFrames, writeArtifact } from './helpers';

type Info = { id: string; t: number; track: { id: string; kind: string; own: boolean }; finalStateHash: string };
type Summary = { ok: boolean; trackId: string | null; ms: number; shots: { label: string; verb: string; t0: number; t1: number; subject: string }[]; diagnostics: { code: string; message: string }[] };
type Hook = { take: () => Info | null; direct: (d: unknown[]) => Promise<Summary | null> };
const manifest = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../public/engine/takes/manifest.json'), 'utf8'));
const entry = manifest.takes[0];
const info = (page: Page) => page.evaluate(() => (window.__marsStudio as unknown as Hook).take());

/** Gene's sentences and the directions CAMERA_DIRECT.md §1 gives for them (null: refused, with its code and question). */
const GENE: { text: string; want: unknown; code?: string; question?: string }[] = [
  { text: 'do a pan across Chiba with the sunset in the background', want: { subject: { kind: 'region', ref: 'chiba' }, motion: { verb: 'pan' }, context: { sunBehind: { sunset: true } } } },
  { text: 'do a 270° revolution around the main pallet racks over 2 minutes', want: { subject: { kind: 'assembly', ref: 'rack bay' }, motion: { verb: 'orbit', degrees: 270 }, duration: 120 } },
  { text: 'go inside the kitchen and face the sink', want: { subject: { kind: 'region', ref: 'kitchen-interior' }, motion: { verb: 'fly_through' }, context: { interior: 'kitchen-interior', lookAt: 'sink' } } },
  { text: 'look at this crowd of people having this activity', want: null, code: 'camera.parse.deictic', question: 'Which activity are the people doing?' },
];

test('direct camera from sentences: Gene\'s four through the panel, refusals with candidates, the orbit computed and played', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const errors = collectConsoleErrors(page);
  await openStudio(page);
  await page.getByRole('combobox', { name: 'Replay take' }).selectOption(entry.id);
  await page.waitForFunction(() => !!(window.__marsStudio as unknown as Hook).take(), null, { timeout: 60_000 });
  const hash = (await info(page))!.finalStateHash;
  await page.locator('.take-direct summary').click();
  const box = page.getByRole('textbox', { name: 'Direction sentence' });
  const jsonBox = page.getByRole('textbox', { name: 'Directions JSON' });
  const list = async () => { const v = (await jsonBox.inputValue()).trim(); return v ? (JSON.parse(v) as unknown[]) : []; };
  // the result line quotes what it added or refused, so wait for this sentence's own result
  const say = async (text: string, marker: string | RegExp) => {
    await box.fill(text);
    await box.press('Enter');
    await expect(page.getByRole('status', { name: 'Sentence parsed' }).or(page.getByRole('alert', { name: 'Sentence refused' }))).toContainText(marker);
  };
  const report: Record<string, unknown> = { take: entry.id, sentences: [] };

  // Gene's four, one at a time, onto one list
  const expected: unknown[] = [];
  for (const g of GENE) {
    const before = await list();
    if (g.want) {
      expected.push(g.want);
      await say(g.text, JSON.stringify(g.want).slice(0, 40));
      await expect(page.getByRole('status', { name: 'Sentence parsed' })).toContainText('Added 1 direction:');
      const after = await list();
      expect(after, `"${g.text}" → appended`).toEqual(expected);
      (report.sentences as unknown[]).push({ text: g.text, parsed: after[after.length - 1] });
    } else {
      await say(g.text, g.code!);
      const after = await list();
      const alert = page.getByRole('alert', { name: 'Sentence refused' });
      await expect(alert).toContainText('Nothing added.');
      await expect(alert).toContainText(g.code!);
      await expect(alert).toContainText(g.question!);
      await expect(alert.locator('mark'), 'the refusal points at the words').toHaveText('this');
      expect(after, 'a refused sentence appends nothing').toEqual(before);
      (report.sentences as unknown[]).push({ text: g.text, refused: await alert.innerText() });
      await captureView(page, 'studio-direct-sentences-refused', { testInfo, compare: false });
    }
  }
  expect(await list()).toEqual(GENE.filter((g) => g.want).map((g) => g.want));

  // an ambiguous word: its candidates are shown; "… then …": two directions at once
  await say('pan across the shed', 'region:shed');
  const amb = page.getByRole('alert', { name: 'Sentence refused' });
  await expect(amb).toContainText('camera.parse.ambiguous');
  await expect(amb).toContainText('Candidates: region:shed, assembly:shed, fixture:shed, entity:shed.');
  report.ambiguous = await amb.innerText();
  await jsonBox.fill('');
  await say('pan across Chiba then orbit 90° around the racks', 'Added 2 directions:');
  await expect(page.getByRole('status', { name: 'Sentence parsed' })).toContainText('Added 2 directions:');
  expect(await list()).toEqual([{ subject: { kind: 'region', ref: 'chiba' }, motion: { verb: 'pan' } }, { subject: { kind: 'assembly', ref: 'rack bay' }, motion: { verb: 'orbit', degrees: 90 } }]);

  // every parsed sentence against this take (report only)
  const compiled: Record<string, unknown> = {};
  for (const g of GENE.filter((x) => x.want)) {
    const r = (await page.evaluate((d) => (window.__marsStudio as unknown as Hook).direct([d]), g.want as never))!;
    compiled[g.text] = r.ok ? { ok: true, ms: r.ms, shots: r.shots.map((x) => `${x.verb} · ${x.subject} · ${x.t0}–${x.t1} s`) } : { ok: false, ms: r.ms, diagnostics: r.diagnostics };
  }
  report.compiledAgainstTake = compiled;

  // the lead's sentence → Compute → shot list → Play
  await jsonBox.fill('');
  await say('do a 270° revolution around the rack bay over 2 minutes', '"duration":120');
  expect(await list()).toEqual([{ subject: { kind: 'assembly', ref: 'rack bay' }, motion: { verb: 'orbit', degrees: 270 }, duration: 120 }]);
  await page.getByRole('button', { name: 'Compute camera' }).click();
  const shots = page.getByRole('list', { name: 'Shot list' });
  await expect(shots).toBeVisible({ timeout: 120_000 });
  const shotText = await shots.innerText();
  expect(shotText).toContain('orbit');
  report.orbit = { shotList: shotText, meta: await page.locator('.direct-meta').innerText() };
  await page.getByRole('button', { name: 'Play directed track' }).click();
  await waitFrames(page, 20);
  await page.getByRole('button', { name: 'Pause take' }).click();
  const playing = (await info(page))!;
  expect(playing.track).toMatchObject({ kind: 'directed', own: false });
  expect(playing.finalStateHash, 'the take is untouched').toBe(hash);
  await captureView(page, 'studio-direct-sentences-orbit', { testInfo, compare: false });
  writeArtifact('studio-direct-sentences.json', report);
  console.log(`studio-direct sentences: ${JSON.stringify(report)}`);
  expect(errors, 'console/page errors').toEqual([]);
});
