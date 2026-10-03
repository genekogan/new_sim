/// <reference types="node" />
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
declare global { interface Window { __marsEngine: EngineHook } }
const artifacts = path.resolve('e2e/artifacts', process.env.E2E_RUN ?? 'prepared-day');
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const finishAction = (page: Page, verb: string) => page.evaluate(verb => {
  const e = window.__marsEngine;
  for (let i = 0; i < 12000; i++) {
    const r = e.records().filter(r => r.verb === verb).at(-1);
    if (r && ['completed', 'cancelled', 'failed'].includes(r.status)) return r;
    e.step();
  }
  throw Error(`${verb} did not finish`);
}, verb);
async function playTicks(page: Page, ticks = 10) {
  const before = await page.evaluate(() => window.__marsEngine.state().tick);
  await button(page, 'Play').click();
  await page.waitForFunction(({ before, ticks }) => window.__marsEngine.state().tick >= before + ticks, { before, ticks });
  await button(page, 'Pause').click();
  expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual([]);
}

async function advance(page: Page, stage: 'notes' | 'released' | 'talks' | 'preparation' | 'paused' | 'sleep' | 'completed' | 'continuations') {
  return page.evaluate(stage => {
    const e = window.__marsEngine;
    for (let i = 0; i < 18000; i++) {
      const day = e.purposefulRoutine(), work = e.workstation().state;
      const reached = stage === 'notes' ? !('code' in work) && work.elapsed >= 2
        : stage === 'released' ? e.records().filter(r => r.verb === 'work_at').at(-1)?.status === 'cancelled'
        : stage === 'talks' ? e.classroom().session?.phase === 'presenting'
        : stage === 'preparation' ? (day?.preparation?.ingredients[0].deposited ?? 0) > 0 && !day?.preparation?.complete
        : stage === 'paused' ? day?.mode === 'paused'
        : stage === 'sleep' ? day?.sleep?.mode === 'sleeping' && day.sleep.elapsed >= 1
        : stage === 'completed' ? day?.status === 'completed'
        : e.gatheringContinuations().length === 2 && e.gatheringContinuations().every(c => c?.status === 'completed');
      if (reached) return { day, work, continuations: e.gatheringContinuations(), tick: e.state().tick };
      if (e.violations().length) throw Error(JSON.stringify(e.violations()));
      if (day && (day.status === 'failed' || day.status === 'cancelled' || day.mode === 'waiting'))
        throw Error(`day stopped before ${stage}: ${JSON.stringify(day)}`);
      e.step();
    }
    throw Error(`day never reached ${stage}: ${JSON.stringify(e.purposefulRoutine())}`);
  }, stage);
}
async function capture(page: Page, name: string) {
  mkdirSync(artifacts, { recursive: true });
  await page.getByTestId('purposeful-routine-readout').scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const e = window.__marsEngine, actor = e.activityExample()!.roles.worker;
    const h = e.state().humans.find(h => h.id === actor)!;
    e.camera([h.p[0] + 4, 3.5, h.p[2] + 4], [h.p[0], .7, h.p[2]]);
  });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({ path: path.join(artifacts, name) });
}

for (const scenario of ['prepared-day-4', 'prepared-day-8', 'prepared-day-studio']) test(`${scenario}: unfinished purpose through a real prepared meal and sleep`, async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  await page.goto(`/lab?scenario=${scenario}`);
  await page.waitForFunction(() => window.__marsEngine?.ready);
  await button(page, 'Reset').click();
  await button(page, 'Step').click();
  expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual([]);
  if (scenario === 'prepared-day-8') {
    for (const item of ['bowl', 'spoon']) {
      await button(page, `Take ${item}`).click();
      expect((await finishAction(page, 'take_item')).status).toBe('completed');
    }
    await button(page, 'Prepare side layout').click();
    expect((await finishAction(page, 'setup_room')).status).toBe('completed');
    await button(page, 'Put belongings away').click();
    expect((await finishAction(page, 'stow_items')).status).toBe('completed');
    await page.evaluate(() => window.__marsEngine.step(2));
  }
  await button(page, 'Start notes').click();
  const initial = await advance(page, 'notes');
  await button(page, 'Interrupt notes').click();
  const unfinished = await advance(page, 'released');
  expect(unfinished.work).toMatchObject({ status: 'unfinished', elapsed: initial.work && !('code' in initial.work) ? initial.work.elapsed : -1 });
  await button(page, 'Start session').click();
  await advance(page, 'talks');
  await expect(button(page, 'Start purposeful routine')).toBeEnabled();
  await button(page, 'Start purposeful routine').click();
  await button(page, 'Commit attendee continuations').click();
  // The running browser loop executes the same Runtime, rather than only a test stepper.
  await playTicks(page);
  const preparation = await advance(page, 'preparation');
  expect(preparation.day?.trip?.participants.every(p => p.arrived)).toBe(true);
  expect(preparation.day?.progress.questionAsked).toBe(true);
  expect(preparation.day?.progress.conversationSeen).toBe(true);
  expect(await page.evaluate(() => window.__marsEngine.workstation().state)).toEqual(unfinished.work);
  await playTicks(page);
  await capture(page, `${scenario}-partial-preparation.png`);
  if (scenario === 'prepared-day-4') {
    await button(page, 'Pause routine').click();
    const paused = await advance(page, 'paused');
    const remembered = paused.day?.preparation;
    await page.evaluate(() => window.__marsEngine.step(30));
    expect(await page.evaluate(() => window.__marsEngine.purposefulRoutine()?.preparation)).toEqual(remembered);
    await capture(page, `${scenario}-retained-preparation.png`);
    await button(page, 'Resume routine').click();
  }
  await advance(page, 'sleep');
  await playTicks(page);
  const sleep = await advance(page, 'sleep');
  expect(sleep.day?.preparation?.complete).toBe(true);
  expect(sleep.day?.progress.meal.every(p => p.consumed && p.returned)).toBe(true);
  expect(await page.evaluate(() => window.__marsEngine.heldItems())).toEqual([]);
  await capture(page, `${scenario}-sleep.png`);
  if (scenario === 'prepared-day-studio') {
    await button(page, 'Pause routine').click();
    const paused = await advance(page, 'paused');
    expect(paused.day?.sleep?.action).toBe(sleep.day?.sleep?.action);
    expect(paused.day?.sleep?.elapsed).toBe(sleep.day?.sleep?.elapsed);
    expect(await page.evaluate(() => {
      const e = window.__marsEngine;
      return e.workstation().claims[`actor:${e.activityExample()!.roles.worker}`];
    })).toEqual([]);
    await capture(page, `${scenario}-sleep-interrupted.png`);
    await button(page, 'Resume routine').click();
  }
  const completed = await advance(page, 'completed');
  expect(completed.day?.sleep?.action).toBe(sleep.day?.sleep?.action);
  expect(completed.day?.sleep?.remaining).toBe(0);
  expect(completed.day?.progress.workElapsed).toBe(30);
  expect(completed.day?.preparation?.ingredients.every(i => i.deposited === 1)).toBe(true);
  expect(completed.day?.progress.meal.every(p => p.served && p.consumed && p.returned)).toBe(true);
  // Independent follow-up work may already own the computer; the finished original
  // intention remains exact and immutable rather than claiming its old workstation.
  await capture(page, `${scenario}-original-purpose-completed.png`);
  const followUps = await advance(page, 'continuations');
  expect(followUps.continuations.every(c => c?.remaining === 0)).toBe(true);
  await page.evaluate(() => window.__marsEngine.step(2));
  expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.heldItems())).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.slots().filter(s => s.claimedBy !== null))).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.records().filter(r => !['completed', 'cancelled'].includes(r.status)))).toEqual([]);
  expect(errors).toEqual([]);
  writeFileSync(path.join(artifacts, `${scenario}-proof.json`), JSON.stringify({ initial, unfinished, preparation, sleep, completed, followUps, errors }, null, 2));
  await button(page, 'Reset').click();
  await expect(button(page, 'Start purposeful routine')).toBeDisabled();
  expect(await page.evaluate(() => window.__marsEngine.purposefulRoutine())).toBeUndefined();
  expect(await page.evaluate(() => window.__marsEngine.sleep())).toBeUndefined();
});
