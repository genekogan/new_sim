/// <reference types="node" />
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
declare global { interface Window { __marsEngine: EngineHook } }
const artifacts = path.resolve('e2e/artifacts', process.env.E2E_RUN ?? 'continuing-day');
const finish = (page: Page, verb: string) => page.evaluate(v => {
  for (let i = 0; i < 12000; i++) {
    const record = window.__marsEngine.records().filter(r => r.verb === v).at(-1);
    if (record && ['completed', 'cancelled', 'failed'].includes(record.status)) return record;
    window.__marsEngine.step();
  }
  throw Error(`${v} did not finish`);
}, verb);
const capture = async (page: Page, name: string, shot: 'classroom' | 'food' | 'work') => {
  await page.evaluate(shot => {
    if (shot === 'work') window.__marsEngine.camera([9, 3.2, -8], [6, .8, -5]);
    else if (shot === 'food') window.__marsEngine.camera([-1, 2.8, 1], [-5, 1, -2]);
    else {
      const worker = window.__marsEngine.state().humans.find(h => h.id === 'worker')!;
      window.__marsEngine.camera([worker.p[0] + 3, 3.2, worker.p[2] - 3], [worker.p[0], 1, worker.p[2]]);
    }
  }, shot);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({ path: path.join(artifacts, name) });
};
for (const count of [4, 8]) test(`one continuing world connects unfinished work, classroom and shared food ${count}`, async ({ page }) => {
  mkdirSync(artifacts, { recursive: true });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`/lab?scenario=work-break-${count}`);
  await page.waitForFunction(() => window.__marsEngine?.ready);
  await page.evaluate(n => window.__marsEngine.runScenario(`work-break-${n}`, { paused: true }), count);
  const epoch = await page.evaluate(() => window.__marsEngine.scenarioEpoch);
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  await expect(page.getByRole('combobox', { name: 'Classroom participant', exact: true })).toHaveValue('worker');
  await expect(button('Prepare side layout')).toBeEnabled();
  await expect(page.getByRole('link', { name: 'Open a separate classroom camera review' })).toHaveAttribute('href', `/cinematography/review.html?scenario=classroom-${count}`);
  if (count === 8) {
    for (const item of ['bowl', 'spoon']) {
      await button(`Take ${item}`).click();
      expect((await finish(page, 'take_item')).status).toBe('completed');
    }
    await button('Prepare side layout').click();
    expect((await finish(page, 'setup_room')).status).toBe('completed');
    const fixtures = await page.evaluate(() => window.__marsEngine.fixtures());
    expect(fixtures.find(e => e.id === 'seat12')).toMatchObject({ support: 'ground', pose: { p: [7.5, 0, 4.5] } });
    expect(fixtures.find(e => e.id === 'belongings-table')).toMatchObject({ support: 'ground', pose: { p: [12, 0, -2] } });
    await button('Put belongings away').click();
    expect((await finish(page, 'stow_items')).status).toBe('completed');
    await page.evaluate(() => window.__marsEngine.step(2));
    expect(await page.evaluate(() => window.__marsEngine.heldItems())).toEqual([]);
  }
  await button('Start notes').click();
  await page.evaluate(() => {
    for (let i = 0; i < 4000; i++) { const w = window.__marsEngine.workstation().state; if (!('code' in w) && w.elapsed >= 2) return; window.__marsEngine.step(); }
    throw Error('notes never progressed');
  });
  await button('Interrupt notes').click();
  expect((await finish(page, 'work_at')).status).toBe('cancelled');
  const unfinished = await page.evaluate(() => window.__marsEngine.workstation().state);
  expect(unfinished).toMatchObject({ status: 'unfinished', task: 'Sketch notes', user: 'worker', duration: 30 });
  await button('Start session').click();
  const admitted = await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) { const s = window.__marsEngine.classroom().session; if (s?.phase === 'presenting' && s.presenter === 'presenter1') return s; window.__marsEngine.step(); }
    throw Error('first talk did not form');
  });
  expect(admitted.participants.filter(p => p.role === 'audience')).toHaveLength(count);
  await button('Join session').click();
  const worker = await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) {
      const p = window.__marsEngine.classroom().session?.participants.find(p => p.actor === 'worker');
      if (p?.arrival === 'seated') return p;
      window.__marsEngine.step();
    }
    throw Error('worker never physically seated');
  });
  expect(worker.seat).toBe(`seat${count === 4 ? 8 : 12}#seat`);
  expect(await page.evaluate(() => window.__marsEngine.classroom().session?.participants.some(p => p.actor === 'visitor'))).toBe(false);
  expect(await page.evaluate(() => window.__marsEngine.slots().find(s => s.id === window.__marsEngine.classroom().session?.participants.find(p => p.actor === 'worker')?.seat)?.occupant)).toBe('worker');
  await button('Ask question').click();
  const question = await page.evaluate(() => {
    for (let i = 0; i < 3000; i++) { const s = window.__marsEngine.classroom().session; if (s?.phase === 'question' && s.floorHolder === 'worker') return s; window.__marsEngine.step(); }
    throw Error('worker question never received floor');
  });
  expect(question.presenter).toBe('presenter1');
  expect(question.attentionTarget?.actor).toBe('worker');
  await capture(page, `continuing-day-${count}-question.png`, 'classroom');
  const second = await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) { const s = window.__marsEngine.classroom().session; if (s?.phase === 'presenting' && s.floorHolder === 'presenter2') return s; window.__marsEngine.step(); }
    throw Error('second presenter never received floor');
  });
  expect(second.presenter).toBe('presenter2');
  const groups = await page.evaluate(() => {
    for (let i = 0; i < 12000; i++) {
      const s = window.__marsEngine.classroom().session;
      if (s?.phase === 'conversing' && s.groups.length && s.groups.every(g => g.status === 'talking' && !!g.floorHolder && g.members.includes(g.floorHolder) && g.attentionTarget?.actor === g.floorHolder)) return s.groups;
      const r = window.__marsEngine.records().filter(r => r.verb === 'classroom_session').at(-1);
      if (r && ['completed', 'failed', 'cancelled'].includes(r.status)) throw Error(`classroom ended before groups: ${JSON.stringify(r)}`);
      window.__marsEngine.step();
    }
    throw Error('classroom groups never formed');
  });
  expect(groups.some(g => g.members.includes('worker'))).toBe(true);
  await expect(button('Resume notes')).toBeDisabled();
  await page.getByText('Direct individual food actions', { exact: true }).click();
  await expect(button('End break conversation')).toBeDisabled();
  await page.getByText('Direct individual food actions', { exact: true }).click();
  await capture(page, `continuing-day-${count}-groups.png`, 'classroom');
  expect((await finish(page, 'classroom_session')).status).toBe('completed');
  expect(await page.evaluate(() => window.__marsEngine.slots().filter(s => s.claimedBy !== null))).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.workstation().state)).toEqual(unfinished);
  await button('Start shared food break').click();
  const eating = await page.evaluate(() => {
    for (let i = 0; i < 12000; i++) {
      const s = window.__marsEngine.sharedFood().at(-1);
      if (s?.phase === 'eating' && s.floorHolder) return s;
      if (s && ['failed', 'cancelled'].includes(s.status)) throw Error(`food break ended: ${JSON.stringify(s)}`);
      window.__marsEngine.step();
    }
    throw Error('shared food never formed');
  });
  expect(await page.evaluate(id => window.__marsEngine.records().find(r => r.id === id)?.phase, eating.group)).toBe('talking');
  expect(eating.participants.map(p => p.actor)).toContain(eating.floorHolder);
  await expect(button('Resume notes')).toBeDisabled();
  await capture(page, `continuing-day-${count}-food.png`, 'food');
  expect((await finish(page, 'shared_food_break')).status).toBe('completed');
  await page.evaluate(() => window.__marsEngine.step(2));
  const food = await page.evaluate(() => window.__marsEngine.sharedFood().at(-1)!);
  expect(food.participants.every(p => !p.held.length && p.returned.length === 2 && p.food === 0)).toBe(true);
  expect(await page.evaluate(() => window.__marsEngine.workstation().state)).toEqual(unfinished);
  await button('Resume notes').click();
  const resumed = await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) { const w = window.__marsEngine.workstation().state; if (!('code' in w) && w.phase === 'working') return w; window.__marsEngine.step(); }
    throw Error('unfinished notes did not resume');
  });
  expect(resumed).toMatchObject({ task: 'Sketch notes', user: 'worker', duration: 30 });
  expect(!('code' in unfinished) && resumed.elapsed >= unfinished.elapsed).toBe(true);
  await capture(page, `continuing-day-${count}-resumed.png`, 'work');
  expect((await finish(page, 'work_at')).status).toBe('completed');
  expect(await page.evaluate(() => window.__marsEngine.workstation().state)).toMatchObject({ status: 'completed', elapsed: 30, duration: 30 });
  expect(await page.evaluate(() => window.__marsEngine.scenarioEpoch)).toBe(epoch);
  expect(await page.evaluate(() => window.__marsEngine.heldItems())).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.slots().filter(s => s.claimedBy !== null))).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.records().filter(r => r.status === 'failed' || !['completed', 'cancelled'].includes(r.status)))).toEqual([]);
  expect(await page.evaluate(() => Object.values(window.__marsEngine.workstation().claims).flat())).toEqual([]);
  expect(errors).toEqual([]);
  writeFileSync(path.join(artifacts, `continuing-day-${count}-proof.json`), JSON.stringify({ epoch, unfinished, worker, question, second, groups, eating, food, resumed, records: await page.evaluate(() => window.__marsEngine.records()), errors }, null, 2));
});
