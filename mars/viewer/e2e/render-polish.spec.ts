// Renderer-only acceptance views. These scenarios and their engine state are owned by the lead.
import { test, expect, type Page } from '@playwright/test';
import { captureView, collectConsoleErrors } from './helpers';
import { labFrames, openLab } from './lab-helpers';
import { paintTexturePath } from '../app/engine-view/paint.ts';

async function look(page: Page, pos: number[], target: number[]) {
  await page.evaluate(([p, t]) => window.__marsEngine!.camera(p, t), [pos, target]);
  await labFrames(page, 4);
}
async function capture(page: Page, name: string, testInfo: Parameters<typeof captureView>[2]['testInfo']) {
  const n = await page.evaluate(() => window.__marsEngine!.info().calls);
  console.log(`[render-polish] ${name}: ${n} draw calls`);
  await captureView(page, name, { testInfo });
}

test('unknown mural name fails visibly and warns only once', () => {
  const warnings: string[] = [];
  const old = console.warn;
  console.warn = (message: string) => warnings.push(message);
  try {
    expect(paintTexturePath('unmapped-test-mural')).toBeNull();
    expect(paintTexturePath('unmapped-test-mural')).toBeNull();
  } finally {
    console.warn = old;
  }
  expect(warnings).toEqual(['[paint] unknown texture "unmapped-test-mural"; using hashed colour and stripe']);
});

test('paint reveal, mounted solar module and distinct equipment', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors = collectConsoleErrors(page);
  await openLab(page, 'solar-paint');
  await page.addStyleTag({ content: '.lab-perf { visibility: hidden }' });
  await page.evaluate(() => window.__marsEngine!.runScenario('solar-paint', { paused: true }));
  const partial = await page.evaluate(() => {
    const h = window.__marsEngine!;
    for (let i = 0; i < 1200; i++) {
      h.step(1);
      const b = h.paints().find((p) => p.id === 'w2')?.bands ?? [];
      if (b.some((v) => v.coverage > 0.3 && v.coverage < 0.7)) return { tick: h.state().tick, bands: b };
    }
    return null;
  });
  expect(partial, 'textured sheet has a partly painted band').not.toBeNull();
  console.log(`[render-polish] mid-paint tick ${partial!.tick}`);
  await page.waitForLoadState('networkidle');
  await look(page, [-3.8, 2.1, 2.6], [0, 1.2, 1.8]);
  await capture(page, 'render-polish-partial-paint', testInfo);

  await page.evaluate(() => window.__marsEngine!.runToEnd(20 * 180));
  await page.waitForLoadState('networkidle');
  const mural = await page.evaluate(() => window.__marsEngine!.paints().find((p) => p.id === 'w2'));
  expect(mural?.texture).toBe('flower-mural-2024');
  expect(mural!.bands.some((b) => b.coverage > 0.9)).toBe(true);
  await look(page, [-4.0, 2.2, 2.5], [0, 1.2, 1.8]);
  await capture(page, 'render-polish-flower-mural', testInfo);

  const mounted = await page.evaluate(() => window.__marsEngine!.components().find((c) => c.id === 'pv2'));
  expect(mounted?.pose.roll).toBeCloseTo(20 * Math.PI / 180, 5);
  await look(page, [-7.6, 1.8, 7.8], [-5, 0.25, 6]);
  await capture(page, 'render-polish-mounted-panel', testInfo);
  // installed at 20° roll: two plumb risers under the high (+x) edge down to the rails; C-channel rail ends
  await look(page, [-2.6, 0.55, 8.4], [-4.3, 0.2, 6]);
  await capture(page, 'render-polish-tilt-legs', testInfo);
  await look(page, [-5.2, 1.2, 12], [-5.2, 0.2, 9.5]);
  await capture(page, 'render-polish-equipment', testInfo);
  expect(errors, 'console/page/network errors').toEqual([]);
});

test('2022 year-build engine upright is green at eye level', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors = collectConsoleErrors(page);
  await openLab(page, 'year-build-2022');
  await page.addStyleTag({ content: '.lab-perf { visibility: hidden }' });
  await page.evaluate(() => window.__marsEngine!.runScenario('year-build-2022', { paused: true }));
  const info = await page.evaluate(() => window.__marsEngine!.yearBuild()!);
  const raise = info.steps.find((s) => s.verb === 'raise_upright')!;
  const result = await page.evaluate((id) => window.__marsEngine!.runUntilSteps([id], 'completed', 20000), raise.id);
  expect(result.reached, `raise step ${raise.id} completed`).toBe(true);
  const up = await page.evaluate((id) => window.__marsEngine!.components().find((c) => c.id === id)!, raise.item!);
  expect(up.def).toMatch(/upright/);
  console.log(`[render-polish] year-build tick ${result.tick}; ${up.id} ${up.def}`);
  const [x, , z] = up.pose.p;
  await look(page, [x + 4.5, 1.65, z + 4.2], [x, 2.1, z]);
  await capture(page, 'render-polish-green-frame', testInfo);
  expect(errors, 'console/page/network errors').toEqual([]);
});
