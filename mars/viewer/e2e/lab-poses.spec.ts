// Engine Lab pose close-ups (capture only, no baselines): the procedural pose layers of
// app/engine-view/humans.ts on top of the Idle/Walk clips. Writes e2e/artifacts/poses/{sit,hold}.png:
// a seated person on a camp chair (campfire-evening, 60 s) and on a bench (75 s, when seated), and a support crew
// holding a raised frame (build-bay, 'held' moment).
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { labFrames, openLab, type LabState } from './lab-helpers';
import { BUILD_BAY_MOMENTS } from '../app/lab/build-bay.ts';

const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'artifacts', 'poses');

async function shot(page: Page, name: string, pos: number[], target: number[]) {
  await page.evaluate(([p, t]) => window.__marsEngine!.camera(p, t), [pos, target]);
  await labFrames(page);
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), animations: 'disabled', caret: 'hide' });
}

/** Camera `dist` m from a person, `side` rad off their facing, looking at `h` m above their feet. */
const near = (p: number[], yaw: number, side: number, dist: number, y: number, h: number): [number[], number[]] => [
  [p[0] + Math.cos(yaw + side) * dist, y, p[2] + Math.sin(yaw + side) * dist],
  [p[0], h, p[2]],
];

test('lab pose close-ups: sit (chair, bench) and hold (support crew)', async ({ page }) => {
  test.setTimeout(240_000);
  await openLab(page, 'campfire-evening');
  await page.addStyleTag({ content: '.lab-perf { visibility: hidden }' });
  await page.evaluate(() => window.__marsEngine!.runScenario('campfire-evening', { paused: true }));
  await page.evaluate(() => window.__marsEngine!.step(400));
  const st: LabState = await page.evaluate(() => window.__marsEngine!.step(800));
  const sitters = st.humans.filter((h) => h.activity === 'sit');
  console.log(`[lab-poses] t60 activities: ${st.humans.map((h) => `${h.id}:${h.activity}`).join(' ')}`);
  expect(sitters.length).toBeGreaterThan(0);
  const info = await page.evaluate(() => window.__marsEngine!.info().humans as unknown as { id: string; sit: number; seat: number | null }[]);
  for (const h of sitters) expect(info.find((i) => i.id === h.id)?.sit, `${h.id} fully seated`).toBe(1);
  for (const [i, h] of sitters.entries()) await shot(page, i ? `sit-${h.id}` : 'sit', ...near(h.p, h.yaw, i % 2 ? -0.7 : 0.7, 2.1, 1.1, 0.6));
  // the bench sitter (x2 sits down at 51 s+) a little later
  const late: LabState = await page.evaluate(() => window.__marsEngine!.step(300));
  const x2 = late.humans.find((h) => h.id === 'x2')!;
  console.log(`[lab-poses] t75 x2: ${x2.activity}`);
  if (x2.activity.startsWith('sit')) await shot(page, 'sit-bench', ...near(x2.p, x2.yaw, -0.7, 2.1, 1.1, 0.6));

  await openLab(page, 'build-bay');
  await page.addStyleTag({ content: '.lab-perf { visibility: hidden }' });
  await page.evaluate(() => window.__marsEngine!.runScenario('build-bay', { paused: true }));
  const held = await page.evaluate((x) => window.__marsEngine!.runUntilSteps(x as string[]), BUILD_BAY_MOMENTS.held as unknown as string[]);
  expect(held.reached).toBe(true);
  const holders = held.humans.filter((h) => h.activity === 'support');
  expect(holders.length).toBeGreaterThan(0);
  const h0 = holders[0];
  await shot(page, 'hold', ...near(h0.p, h0.yaw, 1.3, 3.2, 1.7, 1.0));
});
