import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
declare global { interface Window { __marsEngine: EngineHook } }
const artifacts = path.resolve('e2e/artifacts', process.env.E2E_RUN ?? 'shared-food');
const advance = (page: Page, phase: string) => page.evaluate(phase => {
  for (let i = 0; i < 6000; i++) {
    const state = window.__marsEngine.sharedFood().at(-1);
    if (state && (state.phase === phase || state.status === phase)) return state;
    window.__marsEngine.step();
  }
  throw Error(`shared food did not reach ${phase}: ${JSON.stringify(window.__marsEngine.sharedFood())}`);
}, phase);
const capture = async (page: Page, name: string, work = false) => {
  await page.evaluate(work => work ? window.__marsEngine.camera([9, 3.2, -8], [6, .8, -5]) : window.__marsEngine.camera([-1, 2.8, 1], [-5, 1, -2]), work);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({ path: path.join(artifacts, name) });
};
for (const count of [4, 8]) test(`coordinated food ${count}: live interruption, partial retry and unfinished work`, async ({ page }) => {
  mkdirSync(artifacts, { recursive: true });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`/lab?scenario=work-break-${count}`);
  await page.waitForFunction(() => window.__marsEngine?.ready);
  await page.evaluate(count => window.__marsEngine.runScenario(`work-break-${count}`, { paused: true }), count);
  const epoch = await page.evaluate(() => window.__marsEngine.scenarioEpoch);
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  await button('Start notes').click();
  await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) {
      const w = window.__marsEngine.workstation().state;
      if (!('code' in w) && w.elapsed >= 2) return;
      window.__marsEngine.step();
    }
    throw Error('notes did not progress');
  });
  await button('Interrupt notes').click();
  await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) {
      if (window.__marsEngine.records().filter(r => r.verb === 'work_at').at(-1)?.status === 'cancelled') return;
      window.__marsEngine.step();
    }
    throw Error('notes did not stop');
  });
  const unfinished = await page.evaluate(() => window.__marsEngine.workstation().state);
  await button('Start shared food break').click();
  await advance(page, 'eating');
  await page.evaluate(() => window.__marsEngine.step(20));
  const first = await page.evaluate(() => window.__marsEngine.sharedFood().at(-1)!);
  expect(first.group).toBeTruthy(); expect(['worker', 'visitor']).toContain(first.floorHolder);
  expect(first.participants.every(p => p.food > 0 && p.food < 1 && p.held.length === 2)).toBe(true);
  const hash = await page.evaluate(() => window.__marsEngine.stateHash());
  await page.evaluate(() => { window.__marsEngine.sharedFood(); window.__marsEngine.activityAttention(); });
  expect(await page.evaluate(() => window.__marsEngine.stateHash())).toBe(hash);
  await capture(page, `shared-food-${count}-first-eating.png`);
  if (count === 4) {
    await button('Stop shared food break').click(); await advance(page, 'cancelled');
  } else {
    await page.getByText('Direct individual food actions', { exact: true }).click();
    await page.getByRole('combobox', { name: 'Food-break participant' }).selectOption('worker');
    await button('Direct participant to courtyard').click();
    await advance(page, 'failed');
    await page.evaluate(() => {
      for (let i = 0; i < 6000; i++) {
        const r = window.__marsEngine.records().filter(r => r.verb === 'walk_to' && !r.parent && r.params.actor === 'worker').at(-1);
        if (r?.status === 'completed') return;
        if (r?.status === 'failed' || r?.status === 'cancelled') throw Error(JSON.stringify(r));
        window.__marsEngine.step();
      }
      throw Error('directed walk did not complete');
    });
    const directed = await page.evaluate(() => window.__marsEngine.records().filter(r => r.verb === 'walk_to' && !r.parent && r.params.actor === 'worker').at(-1));
    expect(directed).toMatchObject({ status: 'completed', params: { x: 12, z: 10 } });
    expect((await page.evaluate(() => window.__marsEngine.sharedFood().at(-1)))?.diagnostic?.code).toBe('shared_food.interrupted');
    await page.getByRole('button', { name: /^Dismiss refusal / }).click();
  }
  await page.evaluate(() => window.__marsEngine.step(2));
  expect(await page.evaluate(() => window.__marsEngine.workstation().state)).toEqual(unfinished);
  expect((await page.evaluate(() => window.__marsEngine.sharedFood().at(-1)!)).participants.every(p => p.held.length === 2 && p.food > 0)).toBe(true);
  const beforeRetry = await page.evaluate(() => ({ takes: window.__marsEngine.records().filter(r => r.verb === 'take_item').length, serves: window.__marsEngine.records().filter(r => r.verb === 'serve').length }));
  await button('Start shared food break').click();
  await advance(page, 'eating');
  const floor = await page.evaluate(() => window.__marsEngine.sharedFood().at(-1)?.floorHolder);
  await page.evaluate(floor => {
    for (let i = 0; i < 150; i++) {
      const state = window.__marsEngine.sharedFood().at(-1);
      if (state?.floorHolder && state.floorHolder !== floor) return;
      window.__marsEngine.step();
    }
    throw Error('shared floor did not rotate');
  }, floor);
  await capture(page, `shared-food-${count}-retry-attention.png`);
  const attention = await page.evaluate(() => window.__marsEngine.activityAttention());
  const social = await page.evaluate(() => ({ state: window.__marsEngine.sharedFood().at(-1)!, targets: window.__marsEngine.activityAttentionTargets() }));
  const listener = social.state.participants.find(p => p.actor !== social.state.floorHolder)!.actor;
  expect(Object.keys(social.targets)).toEqual([listener]);
  expect(social.targets[listener]).toEqual([social.state.attentionTarget!.position[0], social.state.attentionTarget!.position[2]]);
  expect(attention.filter(p => ['worker', 'visitor'].includes(p.id)).every(p => Number.isFinite(p.turn) && Math.abs(p.turn) <= .65)).toBe(true);
  await advance(page, 'completed'); await page.evaluate(() => window.__marsEngine.step(2));
  const done = await page.evaluate(() => window.__marsEngine.sharedFood().at(-1)!);
  expect(await page.evaluate(() => window.__marsEngine.activityAttentionTargets())).toEqual({});
  expect(done.participants.every(p => p.food === 0 && p.held.length === 0 && p.returned.length === 2)).toBe(true);
  expect(await page.evaluate(() => ({ takes: window.__marsEngine.records().filter(r => r.verb === 'take_item').length, serves: window.__marsEngine.records().filter(r => r.verb === 'serve').length }))).toEqual(beforeRetry);
  expect(await page.evaluate(() => window.__marsEngine.workstation().state)).toEqual(unfinished);
  await button('Resume notes').click();
  await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) {
      const w = window.__marsEngine.workstation().state;
      if (!('code' in w) && w.phase === 'working') return;
      window.__marsEngine.step();
    }
    throw Error('notes did not resume');
  });
  const resumed = await page.evaluate(() => window.__marsEngine.workstation().state);
  expect(resumed).toMatchObject({ task: 'Sketch notes', user: 'worker', duration: 30, phase: 'working' });
  expect(!('code' in resumed) && !('code' in unfinished) && resumed.elapsed >= unfinished.elapsed).toBe(true);
  await capture(page, `shared-food-${count}-returned.png`, true);
  await page.evaluate(() => window.__marsEngine.step(1000));
  expect(await page.evaluate(() => window.__marsEngine.workstation().state)).toMatchObject({ status: 'completed', elapsed: 30 });
  expect(await page.evaluate(() => window.__marsEngine.scenarioEpoch)).toBe(epoch);
  expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.slots().filter(s => s.claimedBy !== null))).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.records().filter(r => !['completed', 'cancelled', 'failed'].includes(r.status)))).toEqual([]);
  expect(errors).toEqual([]);
  writeFileSync(path.join(artifacts, `shared-food-${count}-proof.json`), JSON.stringify({ epoch, unfinished, first, done, resumed, attention, records: await page.evaluate(() => window.__marsEngine.records()), errors }, null, 2));
});
