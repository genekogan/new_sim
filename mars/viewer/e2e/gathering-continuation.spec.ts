/// <reference types="node" />
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
declare global { interface Window { __marsEngine: EngineHook } }
const artifacts = path.resolve('e2e/artifacts', process.env.E2E_RUN ?? 'gathering-continuation');
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const settle = (page: Page, verb: string) => page.evaluate(verb => {
  for (let i = 0; i < 12000; i++) {
    const r = window.__marsEngine.records().filter(r => r.verb === verb).at(-1);
    if (r && ['completed', 'cancelled', 'failed'].includes(r.status)) return r.status;
    window.__marsEngine.step();
  }
  throw Error(`Did not settle ${verb}`);
}, verb);
async function prepare(page: Page, count: number) {
  await page.goto(`/lab?scenario=work-break-${count}`);
  await page.waitForFunction(() => window.__marsEngine?.ready);
  await page.evaluate(n => window.__marsEngine.runScenario(`work-break-${n}`, { paused: true }), count);
  await expect(button(page, 'Commit attendee continuations')).toBeDisabled();
  if (count === 8) {
    for (const item of ['bowl', 'spoon']) {
      await button(page, `Take ${item}`).click();
      expect(await settle(page, 'take_item')).toBe('completed');
    }
    await button(page, 'Prepare side layout').click();
    expect(await settle(page, 'setup_room')).toBe('completed');
    await button(page, 'Put belongings away').click();
    expect(await settle(page, 'stow_items')).toBe('completed');
    await page.evaluate(() => window.__marsEngine.step(2));
  }
  await button(page, 'Start notes').click();
  await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) {
      const w = window.__marsEngine.workstation().state;
      if (!('code' in w) && w.elapsed >= 2) return;
      window.__marsEngine.step();
    }
    throw Error('Notes did not progress');
  });
  await button(page, 'Interrupt notes').click();
  expect(await settle(page, 'work_at')).toBe('cancelled');
  await button(page, 'Start session').click();
  await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) {
      if (window.__marsEngine.classroom().session?.phase === 'presenting') return;
      window.__marsEngine.step();
    }
    throw Error('Talks did not start');
  });
  await button(page, 'Start purposeful routine').click();
  await button(page, 'Commit attendee continuations').click();
}
const advance = (page: Page, stage: 'discussion' | 'work' | 'finished' | 'paused') => page.evaluate(stage => {
  for (let i = 0; i < 18000; i++) {
    const e = window.__marsEngine, states = e.gatheringContinuations();
    const work = states.find(s => s?.bindings.binding.kind === 'work');
    const discussion = states.find(s => s?.bindings.binding.kind === 'discussion');
    if (!work || !discussion) throw Error('Continuation binding missing');
    const reached = stage === 'discussion' ? discussion.elapsed >= 1 && !!discussion.floorHolder && work.mode === 'awaiting'
      : stage === 'work' ? work.elapsed >= 1 && work.status !== 'completed'
      : stage === 'paused' ? discussion.mode === 'paused'
      : states.every(s => s && ['completed', 'cancelled'].includes(s.status)) && e.purposefulRoutine()?.status === 'completed';
    if (reached) return { work, discussion, routine: e.purposefulRoutine() };
    if (states.some(s => s?.status === 'failed' || s?.mode === 'waiting')) throw Error(`Unexpected wait/refusal: ${JSON.stringify(states)}`);
    e.step();
  }
  throw Error(`Did not reach ${stage}`);
}, stage);
async function capture(page: Page, filename: string, work = false) {
  mkdirSync(artifacts, { recursive: true });
  await page.getByTestId('gathering-continuation-hud').scrollIntoViewIfNeeded();
  await page.evaluate(work => window.__marsEngine.camera(work ? [9, 3.2, -8] : [-3, 4, 2], work ? [6, .8, -5] : [-7, 1, 6]), work);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({ path: path.join(artifacts, filename) });
}
async function clean(page: Page) {
  expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.heldItems())).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.slots().filter(s => s.claimedBy !== null))).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.records().filter(r => !['completed', 'cancelled'].includes(r.status)))).toEqual([]);
}
for (const count of [4, 8]) test(`attendees continue discussion and computer follow-up in ${count}-guest room`, async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await prepare(page, count);
  const epoch = await page.evaluate(() => window.__marsEngine.scenarioEpoch);
  const start = await page.evaluate(() => window.__marsEngine.state().tick);
  await button(page, 'Play').click();
  await page.waitForFunction(t => window.__marsEngine.state().tick >= t + 10, start);
  await button(page, 'Pause').click();
  const talking = await advance(page, 'discussion');
  expect(talking.routine?.status).not.toBe('completed');
  await expect(page.getByTestId('continuation-discussion')).toContainText('Speaking:');
  await page.waitForFunction(() => {
    const e = window.__marsEngine, pair = e.gatheringContinuations().find(s => s?.bindings.binding.kind === 'discussion');
    if (!pair?.attentionTarget || !pair.floorHolder || pair.bindings.binding.kind !== 'discussion') return false;
    const listener = pair.bindings.binding.actors.find(a => a !== pair.floorHolder)!;
    return JSON.stringify(e.activityAttentionTargets()[listener]) === JSON.stringify(pair.attentionTarget.point);
  });
  await capture(page, `continuation-${count}-discussion.png`);
  const working = await advance(page, 'work');
  expect(working.routine?.progress.workElapsed).toBe(30);
  expect(working.routine?.status).toBe('completed');
  await expect(page.getByTestId('continuation-work')).toContainText('running');
  await capture(page, `continuation-${count}-work.png`, true);
  const finished = await advance(page, 'finished');
  expect(finished.work.elapsed).toBe(12);
  expect(finished.discussion.elapsed).toBe(20);
  await expect(page.getByTestId('continuation-work')).toContainText('Finished');
  await expect(page.getByTestId('continuation-discussion')).toContainText('Finished');
  await clean(page);
  expect(await page.evaluate(() => window.__marsEngine.scenarioEpoch)).toBe(epoch);
  expect(errors).toEqual([]);
});
test('ending only the guest discussion preserves worker and presenter commitments; reset clears identities', async ({ page }) => {
  await prepare(page, 4);
  const talking = await advance(page, 'discussion');
  await button(page, 'Pause discussion').click();
  const paused = await advance(page, 'paused');
  expect(paused.discussion.elapsed).toBeGreaterThanOrEqual(talking.discussion.elapsed);
  await page.evaluate(() => window.__marsEngine.step(20));
  expect(await page.evaluate(() => window.__marsEngine.gatheringContinuations().find(s => s?.bindings.binding.kind === 'discussion')?.elapsed)).toBe(paused.discussion.elapsed);
  await button(page, 'End discussion').click();
  const final = await advance(page, 'finished');
  expect(final.discussion.status).toBe('cancelled');
  expect(final.work.status).toBe('completed');
  expect(final.routine?.status).toBe('completed');
  await expect(page.getByTestId('continuation-discussion')).toContainText('remaining commitment was not fulfilled');
  await capture(page, 'continuation-ended-discussion.png', true);
  await clean(page);
  await button(page, 'Reset').click();
  await expect(button(page, 'Commit attendee continuations')).toBeDisabled();
  expect(await page.evaluate(() => window.__marsEngine.gatheringContinuations())).toEqual([]);
  await expect(page.getByTestId('continuation-work')).toHaveCount(0);
});
test('live courtyard direction pauses only the affected discussion, then Resume keeps the same partner and remaining talk', async ({ page }) => {
  await prepare(page, 4);
  const before = await advance(page, 'discussion');
  await page.getByRole('combobox', { name: 'Classroom participant', exact: true }).selectOption('guest1');
  await button(page, 'Direct to courtyard').click();
  const directed = await page.evaluate(() => window.__marsEngine.records().filter(r => r.verb === 'walk_to' && !r.parent && r.params.actor === 'guest1').at(-1)?.id);
  expect(directed).toBeTruthy();
  expect(await page.evaluate(id => {
    for (let i = 0; i < 12000; i++) {
      const record = window.__marsEngine.records().find(r => r.id === id);
      if (record && ['completed', 'cancelled', 'failed'].includes(record.status)) return record.status;
      window.__marsEngine.step();
    }
    throw Error(`Directed walk ${id} did not finish`);
  }, directed)).toBe('completed');
  const stopped = await page.evaluate(() => window.__marsEngine.gatheringContinuations().find(s => s?.bindings.binding.kind === 'discussion'));
  expect(stopped?.mode).toBe('waiting');
  expect(stopped?.diagnostic?.code).toBe('continuation.directed-away');
  expect(stopped?.elapsed).toBeGreaterThanOrEqual(before.discussion.elapsed);
  expect(stopped?.remaining).toBeGreaterThan(0);
  expect(stopped?.bindings.binding).toEqual(before.discussion.bindings.binding);
  expect(await page.evaluate(() => window.__marsEngine.purposefulRoutine()?.status)).not.toBe('cancelled');
  await expect(page.getByTestId('continuation-discussion')).toContainText('continuation.directed-away');
  await capture(page, 'continuation-directed-away.png');
  await button(page, 'Resume discussion').click();
  const finished = await advance(page, 'finished');
  expect(finished.discussion.elapsed).toBe(20);
  expect(finished.work.status).toBe('completed');
  await clean(page);
});
