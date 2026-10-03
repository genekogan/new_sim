import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
declare global { interface Window { __marsEngine: EngineHook } }
const artifacts = path.resolve('e2e/artifacts', process.env.E2E_RUN ?? 'work-break');
const settle = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
const finish = (page: Page, verb: string, actor?: string) => page.evaluate(({ verb, actor }) => {
  for (let i = 0; i < 6000; i++) {
    const record = window.__marsEngine.records().filter(r => r.verb === verb && (!actor || r.params.actor === actor)).at(-1);
    if (record && ['completed', 'cancelled', 'failed'].includes(record.status)) return record;
    window.__marsEngine.step();
  }
  throw Error(`${verb}/${actor ?? 'group'} did not finish`);
}, { verb, actor });

for (const count of [4, 8]) test(`one continuing world ${count}: notes → shared food → explicit returns → same notes`, async ({ page }) => {
  mkdirSync(artifacts, { recursive: true });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`/lab?scenario=work-break-${count}`);
  await page.waitForFunction(() => window.__marsEngine?.ready);
  await page.evaluate(count => window.__marsEngine.runScenario(`work-break-${count}`, { paused: true }), count);
  const epoch = await page.evaluate(() => window.__marsEngine.scenarioEpoch);
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const participant = page.getByRole('combobox', { name: 'Food-break participant' });
  await button('Start notes').click();
  await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) {
      const state = window.__marsEngine.workstation().state;
      if (!('code' in state) && state.elapsed >= 2) return;
      window.__marsEngine.step();
    }
    throw Error('notes never started');
  });
  await button('Interrupt notes').click();
  expect((await finish(page, 'work_at', 'worker')).status).toBe('cancelled');
  const unfinished = await page.evaluate(() => window.__marsEngine.workstation().state);
  expect(unfinished).toMatchObject({ status: 'unfinished', user: 'worker', task: 'Sketch notes', duration: 30 });
  await page.getByText('Direct individual food actions', { exact: true }).click();
  for (const actor of ['worker', 'visitor']) {
    await participant.selectOption(actor);
    await button('Take break bowl').click(); expect((await finish(page, 'take_item', actor)).status).toBe('completed');
    await button('Take break spoon').click(); expect((await finish(page, 'take_item', actor)).status).toBe('completed');
    if (actor === 'worker') {
      const hash = await page.evaluate(() => window.__marsEngine.stateHash());
      await button('Resume notes').click();
      await expect(page.getByTestId('break-feedback')).toContainText('workstation.hands-occupied');
      expect(await page.evaluate(() => window.__marsEngine.stateHash())).toBe(hash);
      await page.getByRole('button', { name: /^Dismiss refusal / }).click();
      expect(await page.evaluate(() => window.__marsEngine.stateHash())).toBe(hash);
      expect(await page.evaluate(() => window.__marsEngine.records().filter(r => r.status === 'failed').map(r => r.diagnostic?.code))).toEqual(['workstation.hands-occupied']);
      await expect(page.getByRole('alert')).toHaveCount(0);
    }
    await button('Approach serving pot').click(); expect((await finish(page, 'walk_to', actor)).status).toBe('completed');
    await button('Serve stew').click();
    await page.evaluate(actor => {
      for (let i = 0; i < 6000; i++) {
        const r = window.__marsEngine.records().filter(r => r.verb === 'serve' && r.params.actor === actor).at(-1);
        if (r?.phase === 'to-bowl') return;
        window.__marsEngine.step();
      }
      throw Error('no physical serving phase');
    }, actor);
    await page.evaluate(() => window.__marsEngine.camera([-1.5, 2.8, -8], [-5, 1, -5]));
    await settle(page); await page.screenshot({ path: path.join(artifacts, `work-break-${count}-${actor}-serving.png`) });
    expect((await finish(page, 'serve', actor)).status).toBe('completed');
    await expect(page.getByTestId('break-food-readout')).toContainText('bowl 100%');
  }
  await button('Gather for shared break').click();
  await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) {
      if (window.__marsEngine.records().some(r => r.verb === 'converse' && r.phase === 'talking' && r.status === 'executing')) return;
      window.__marsEngine.step();
    }
    throw Error('no shared conversation');
  });
  for (const actor of ['worker', 'visitor']) {
    await participant.selectOption(actor);
    await button('Eat stew').click();
  }
  await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) {
      if (window.__marsEngine.records().filter(r => r.verb === 'eat' && r.phase === 'lift' && r.status === 'executing').length === 2) return;
      window.__marsEngine.step();
    }
    throw Error('no physical shared eating');
  });
  await page.evaluate(() => window.__marsEngine.camera([-1, 2.4, 1], [-5, 1, -2]));
  await settle(page); await page.screenshot({ path: path.join(artifacts, `work-break-${count}-eating.png`) });
  if (count === 4) {
    await button('Stop food action').click(); expect((await finish(page, 'eat', 'visitor')).status).toBe('cancelled');
    expect(await page.evaluate(() => window.__marsEngine.records().some(r => r.verb === 'converse' && r.status === 'executing'))).toBe(true);
    await button('Eat stew').click();
  }
  for (const actor of ['worker', 'visitor']) {
    expect((await finish(page, 'eat', actor)).status).toBe('completed');
    await participant.selectOption(actor); await expect(page.getByTestId('break-food-readout')).toContainText('bowl 0%');
  }
  expect(await page.evaluate(() => window.__marsEngine.workstation().state)).toEqual(unfinished);
  await button('End break conversation').click(); expect((await finish(page, 'converse')).status).toBe('cancelled');
  for (const actor of ['worker', 'visitor']) {
    await participant.selectOption(actor); await button('Return break utensils').click();
    expect((await finish(page, 'stow_items', actor)).status).toBe('completed');
  }
  await page.evaluate(() => window.__marsEngine.step(2));
  expect(await page.evaluate(() => window.__marsEngine.heldItems())).toEqual([]);
  await button('Resume notes').click();
  await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) {
      const state = window.__marsEngine.workstation().state;
      if (!('code' in state) && state.phase === 'working') return;
      window.__marsEngine.step();
    }
    throw Error('no actual resumed work');
  });
  const resumed = await page.evaluate(() => window.__marsEngine.workstation().state);
  expect(resumed).toMatchObject({ user: 'worker', task: 'Sketch notes', duration: 30, phase: 'working' });
  expect(!('code' in resumed) && !('code' in unfinished) && resumed.elapsed >= unfinished.elapsed).toBe(true);
  await page.evaluate(() => window.__marsEngine.camera([9, 3.2, -8], [6, .8, -5]));
  await settle(page); await page.screenshot({ path: path.join(artifacts, `work-break-${count}-returned-notes.png`) });
  expect((await finish(page, 'work_at', 'worker')).status).toBe('completed');
  const completed = await page.evaluate(() => window.__marsEngine.workstation().state);
  expect(completed).toMatchObject({ status: 'completed', user: 'worker', task: 'Sketch notes', duration: 30, elapsed: 30 });
  expect(await page.evaluate(() => window.__marsEngine.scenarioEpoch)).toBe(epoch);
  expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual([]);
  const records = await page.evaluate(() => window.__marsEngine.records());
  expect(records.filter(r => r.status === 'failed').map(r => r.diagnostic?.code)).toEqual(['workstation.hands-occupied']);
  expect(records.filter(r => !['completed', 'cancelled', 'failed'].includes(r.status))).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.slots().filter(s => s.claimedBy !== null))).toEqual([]);
  expect(errors).toEqual([]);
  writeFileSync(path.join(artifacts, `work-break-${count}-proof.json`), JSON.stringify({ epoch, unfinished, resumed, completed, records, errors }, null, 2));
});
