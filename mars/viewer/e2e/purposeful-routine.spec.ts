/// <reference types="node" />
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
declare global { interface Window { __marsEngine: EngineHook } }
const artifacts = path.resolve('e2e/artifacts', process.env.E2E_RUN ?? 'purposeful-routine');
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const finish = (page: Page, verb: string) => page.evaluate(verb => {
  for (let i = 0; i < 12000; i++) {
    const r = window.__marsEngine.records().filter(r => r.verb === verb).at(-1);
    if (r && ['completed', 'cancelled', 'failed'].includes(r.status)) return r;
    window.__marsEngine.step();
  }
  throw Error(`${verb} did not finish`);
}, verb);
const prepare = async (page: Page, count: number, paired = false) => {
  await page.goto(`/lab?scenario=work-break-${count}`);
  await page.waitForFunction(() => window.__marsEngine?.ready);
  await page.evaluate(n => window.__marsEngine.runScenario(`work-break-${n}`, { paused: true }), count);
  await expect(button(page, 'Start purposeful routine')).toBeDisabled();
  if (count === 8) {
    for (const item of ['bowl', 'spoon']) {
      await button(page, `Take ${item}`).click();
      expect((await finish(page, 'take_item')).status).toBe('completed');
    }
    await button(page, 'Prepare side layout').click();
    expect((await finish(page, 'setup_room')).status).toBe('completed');
    await button(page, 'Put belongings away').click();
    expect((await finish(page, 'stow_items')).status).toBe('completed');
    await page.evaluate(() => window.__marsEngine.step(2));
  }
  await button(page, 'Start notes').click();
  await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) {
      const w = window.__marsEngine.workstation().state;
      if (!('code' in w) && w.elapsed >= 2) return;
      window.__marsEngine.step();
    }
    throw Error('notes never progressed');
  });
  await button(page, 'Interrupt notes').click();
  expect((await finish(page, 'work_at')).status).toBe('cancelled');
  const unfinished = await page.evaluate(() => window.__marsEngine.workstation().state);
  await button(page, 'Start session').click();
  await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) {
      if (window.__marsEngine.classroom().session?.phase === 'presenting') return;
      window.__marsEngine.step();
    }
    throw Error('talks never began');
  });
  await expect(button(page, 'Start purposeful routine')).toBeEnabled();
  if (paired) await page.getByRole('checkbox', { name: 'Walk to lunch together before sharing food', exact: true }).check();
  await button(page, 'Start purposeful routine').click();
  return unfinished;
};
type Stage = 'question' | 'conversation' | 'meal' | 'rest' | 'paused' | 'completed';
const advance = (page: Page, stage: Stage) => page.evaluate(stage => {
  for (let i = 0; i < 18000; i++) {
    const e = window.__marsEngine, routine = e.purposefulRoutine();
    if (!routine) throw Error('routine missing');
    const s = e.classroom().session;
    const reached = stage === 'question' ? routine.progress.questionAsked && s?.phase === 'question' && s.floorHolder === 'worker'
      : stage === 'conversation' ? routine.progress.conversationSeen && s?.groups.some(g => g.status === 'talking' && g.members.includes('worker'))
      : stage === 'meal' ? e.sharedFood().at(-1)?.phase === 'eating' && routine.progress.meal.some(m => m.fraction > 0 && m.fraction < 1)
      : stage === 'rest' ? routine.progress.restSeconds >= 1
      : stage === 'paused' ? routine.mode === 'paused'
      : routine.mode === 'completed';
    if (reached) return routine;
    if (['failed', 'cancelled'].includes(routine.status) || routine.mode === 'waiting' || routine.mode === 'completed')
      throw Error(`routine ended before ${stage}: ${JSON.stringify(routine)}`);
    e.step();
  }
  throw Error(`routine never reached ${stage}`);
}, stage);
const capture = async (page: Page, filename: string, work = false) => {
  mkdirSync(artifacts, { recursive: true });
  const progress = await page.evaluate(() => window.__marsEngine.purposefulRoutine());
  const readout = page.getByTestId('purposeful-routine-readout');
  if (progress?.progress.questionAsked) await expect(readout).toContainText('Question: asked');
  if (progress?.progress.conversationSeen) await expect(readout).toContainText('Conversation: joined');
  if (progress?.status === 'completed') await expect(readout).toContainText('Same Sketch notes: 30.0/30s');
  await page.getByTestId('purposeful-routine-readout').scrollIntoViewIfNeeded();
  await page.evaluate(work => {
    const e = window.__marsEngine, w = e.state().humans.find(h => h.id === 'worker')!;
    if (work) e.camera([9, 3.2, -8], [6, .8, -5]);
    else e.camera([w.p[0] + 4, 3.5, w.p[2] - 4], [w.p[0], 1, w.p[2]]);
  }, work);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({ path: path.join(artifacts, filename) });
};
const clean = async (page: Page) => {
  expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.heldItems())).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.slots().filter(s => s.claimedBy !== null))).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.records().filter(r => !['completed', 'cancelled'].includes(r.status)))).toEqual([]);
};
for (const count of [4, 8]) test(`purposeful gathering, meal, rest and same notes in ${count}-guest room`, async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  const unfinished = await prepare(page, count);
  const epoch = await page.evaluate(() => window.__marsEngine.scenarioEpoch);
  // Exercise the actual animation-frame playback path before bounded stepping.
  const startTick = await page.evaluate(() => window.__marsEngine.state().tick);
  await button(page, 'Play').click();
  await page.waitForFunction(tick => window.__marsEngine.state().tick >= tick + 10, startTick);
  await button(page, 'Pause').click();
  const question = await advance(page, 'question');
  expect(await page.evaluate(() => window.__marsEngine.classroom().session?.attentionTarget?.actor)).toBe('worker');
  expect(await page.evaluate(() => window.__marsEngine.slots().find(s => s.occupant === 'worker')?.id)).toBe(`seat${count === 4 ? 8 : 12}#seat`);
  await capture(page, `purposeful-${count}-question.png`);
  const conversation = await advance(page, 'conversation');
  await capture(page, `purposeful-${count}-conversation.png`);
  const meal = await advance(page, 'meal');
  expect(await page.evaluate(() => window.__marsEngine.workstation().state)).toEqual(unfinished);
  await capture(page, `purposeful-${count}-meal.png`);
  const rest = await advance(page, 'rest');
  expect(await page.evaluate(() => window.__marsEngine.slots().find(s => s.occupant === 'worker')?.id)).toBe(`seat${count === 4 ? 8 : 12}#seat`);
  await capture(page, `purposeful-${count}-rest.png`);
  const completed = await advance(page, 'completed');
  expect(completed.progress).toMatchObject({ questionAsked: true, conversationSeen: true, restSeconds: 5, workElapsed: 30 });
  expect(completed.progress.presenters).toEqual(['presenter1', 'presenter2']);
  expect(completed.progress.meal.every(m => m.served && m.consumed && m.returned && m.fraction === 0)).toBe(true);
  expect(await page.evaluate(() => window.__marsEngine.workstation().state)).toMatchObject({ user: 'worker', task: 'Sketch notes', duration: 30, elapsed: 30, status: 'completed' });
  expect(await page.evaluate(() => window.__marsEngine.scenarioEpoch)).toBe(epoch);
  await page.evaluate(() => window.__marsEngine.step(2));
  await clean(page);
  expect(errors).toEqual([]);
  await capture(page, `purposeful-${count}-completed.png`, true);
  let reuse: { workstation: unknown; routine: unknown } | undefined;
  if (count === 4) {
    // A new task may reuse even the same labels. A finished intention stays historical.
    await button(page, 'Start notes').click();
    const repeatedStation = await page.evaluate(() => {
      for (let i = 0; i < 6000; i++) {
        const w = window.__marsEngine.workstation().state;
        if (!('code' in w) && w.user === 'worker' && w.status === 'active' && w.phase === 'working' && w.elapsed >= 1) return w;
        window.__marsEngine.step();
      }
      throw Error('worker never started a new task with the same labels');
    });
    const remembered = await page.evaluate(() => window.__marsEngine.purposefulRoutine());
    expect(remembered?.bindings.actor).toBe('worker');
    expect(remembered?.progress.workElapsed).toBe(30);
    await capture(page, 'purposeful-4-computer-reused-same-labels.png', true);
    expect((await finish(page, 'work_at')).status).toBe('completed');
    await page.evaluate(() => window.__marsEngine.step(2));
    await clean(page);
    expect(errors).toEqual([]);
    reuse = { workstation: repeatedStation, routine: remembered };
  }
  writeFileSync(path.join(artifacts, `purposeful-${count}-proof.json`), JSON.stringify({ epoch, unfinished, question, conversation, meal, rest, completed, reuse, errors }, null, 2));
});
test('routine pauses a partial meal without serving again, and reset releases stale UI identity', async ({ page }) => {
  await prepare(page, 4);
  await advance(page, 'meal');
  const serves = await page.evaluate(() => window.__marsEngine.records().filter(r => r.verb === 'serve').length);
  await button(page, 'Pause routine').click();
  const paused = await advance(page, 'paused');
  expect(paused.progress.meal.some(m => m.served && !m.consumed)).toBe(true);
  const before = await page.evaluate(() => window.__marsEngine.workstation().state);
  await page.evaluate(() => window.__marsEngine.step(40));
  expect(await page.evaluate(() => window.__marsEngine.workstation().state)).toEqual(before);
  await expect(button(page, 'Resume routine')).toBeEnabled();
  await capture(page, 'purposeful-paused-meal.png');
  await button(page, 'Resume routine').click();
  await advance(page, 'completed');
  expect(await page.evaluate(() => window.__marsEngine.records().filter(r => r.verb === 'serve').length)).toBe(serves);
  await page.evaluate(() => window.__marsEngine.step(2));
  await clean(page);
  await button(page, 'Reset').click();
  await expect(page.getByTestId('purposeful-routine-readout')).toContainText('No routine committed');
  await expect(button(page, 'Resume routine')).toBeDisabled();
  await expect(button(page, 'End routine')).toBeDisabled();
  expect(await page.evaluate(() => window.__marsEngine.purposefulRoutine())).toBeUndefined();
});
test('ending a routine leaves the independent gathering running and the notes unfinished', async ({ page }) => {
  const unfinished = await prepare(page, 4);
  await advance(page, 'question');
  const session = await page.evaluate(() => window.__marsEngine.classroom().session!.session);
  await button(page, 'End routine').click();
  expect((await finish(page, 'purposeful_routine')).status).toBe('cancelled');
  const remaining = await page.evaluate(id => ({
    record: window.__marsEngine.records().find(r => r.id === id),
    people: window.__marsEngine.classroom().session?.participants,
    work: window.__marsEngine.workstation().state,
  }), session);
  expect(remaining.record?.status).not.toBe('cancelled');
  expect(remaining.people?.find(p => p.actor === 'guest1')?.state).toBe('participating');
  expect(remaining.work).toEqual(unfinished);
  await expect(page.getByTestId('purposeful-routine-readout')).toContainText('ended; remaining activities were not completed');
  await expect(button(page, 'Resume routine')).toBeDisabled();
  await expect(button(page, 'End routine')).toBeDisabled();
  expect((await finish(page, 'classroom_session')).status).toBe('completed');
  await page.evaluate(() => window.__marsEngine.step(2));
  expect(await page.evaluate(() => window.__marsEngine.records().some(r => r.verb === 'shared_food_break'))).toBe(false);
  await clean(page);
  await capture(page, 'purposeful-ended.png');
});


for (const count of [4, 8]) test(`paired lunch walk in ${count} room uses actual Play, pauses/resumes same trip, then same notes`, async ({ page }) => {
  await prepare(page, count, true);
  const trip = await page.evaluate(() => {
    for (let i = 0; i < 16000; i++) {
      const state = window.__marsEngine.purposefulRoutine();
      if (state?.trip?.mode === 'walking' && state.trip.participants.every(p => p.progress > 1)) return state.trip;
      if (state?.mode === 'waiting' || state?.status === 'failed') throw Error(JSON.stringify(state));
      window.__marsEngine.step();
    }
    throw Error('Pair never physically walked');
  });
  await button(page, 'Play').click();
  await page.waitForFunction(progress => {
    const trip = window.__marsEngine.purposefulRoutine()?.trip;
    return !!trip && trip.participants.every(p => p.progress > progress);
  }, Math.max(...trip.participants.map(p => p.progress)) + 0.15);
  await button(page, 'Pause').click();
  const walking = await page.evaluate(() => window.__marsEngine.purposefulRoutine()!.trip!);
  expect(walking.separation).toBeLessThanOrEqual(1.8);
  expect(walking.action).toBe(trip.action);
  await capture(page, `paired-${count}-walking.png`);
  await button(page, 'Pause routine').click();
  await advance(page, 'paused');
  const paused = await page.evaluate(() => window.__marsEngine.purposefulRoutine()!.trip!);
  expect(paused.mode).toBe('paused'); expect(paused.action).toBe(trip.action);
  await button(page, 'Resume routine').click();
  await advance(page, 'meal');
  expect(await page.evaluate(() => window.__marsEngine.purposefulRoutine()!.trip!.participants.every(p => p.arrived))).toBe(true);
  await capture(page, `paired-${count}-meal.png`);
  await advance(page, 'completed');
  expect(await page.evaluate(() => window.__marsEngine.purposefulRoutine()!.trip!.action)).toBe(trip.action);
  await clean(page);
});
