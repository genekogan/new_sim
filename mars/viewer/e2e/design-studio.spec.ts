/// <reference types="node" />
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
declare global { interface Window { __marsEngine: EngineHook } }
const artifacts = path.resolve('e2e/artifacts', process.env.E2E_RUN ?? 'design-studio');
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
async function prepare(page: Page, paired = false) {
  await page.goto('/lab?scenario=design-studio');
  await page.waitForFunction(() => window.__marsEngine?.ready);
  await page.evaluate(() => window.__marsEngine.runScenario('design-studio', { paused: true }));
  const bindings = await page.evaluate(() => window.__marsEngine.activityExample());
  expect(bindings?.roles.worker).toBe('project-editor');
  expect(bindings?.workBreak.work.station).toBe('studio-computer');
  expect(await page.evaluate(() => window.__marsEngine.state().humans.some(h => h.id === 'worker'))).toBe(false);
  await expect(page.getByTestId('purposeful-routine-hud')).toContainText('Prototype project notes');
  await button(page, 'Start notes').click();
  await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) {
      const w = window.__marsEngine.workstation().state;
      if (!('code' in w) && w.elapsed >= 2) return;
      window.__marsEngine.step();
    }
    throw Error('Project notes did not progress');
  });
  await button(page, 'Interrupt notes').click();
  await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) {
      const w = window.__marsEngine.workstation().state;
      if (!('code' in w) && w.status === 'unfinished' && !window.__marsEngine.records().some(r => r.verb === 'work_at' && !['completed', 'cancelled', 'failed'].includes(r.status))) return;
      window.__marsEngine.step();
    }
    throw Error('Project editor did not safely stop');
  });
  await button(page, 'Start session').click();
  await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) {
      if (window.__marsEngine.classroom().session?.phase === 'presenting') return;
      window.__marsEngine.step();
    }
    throw Error('Critique did not start');
  });
  if (paired) await page.getByRole('checkbox', { name: 'Walk to lunch together before sharing food', exact: true }).check();
  await button(page, 'Start purposeful routine').click();
  await button(page, 'Commit attendee continuations').click();
}
const advance = (page: Page, stage: 'question' | 'discussion' | 'work' | 'finished') => page.evaluate(stage => {
  for (let i = 0; i < 18000; i++) {
    const e = window.__marsEngine, r = e.purposefulRoutine(), states = e.gatheringContinuations();
    const w = states.find(s => s?.bindings.binding.kind === 'work'), d = states.find(s => s?.bindings.binding.kind === 'discussion');
    if (!r || !w || !d) throw Error('Studio intentions missing');
    const reached = stage === 'question' ? r.progress.questionAsked && e.classroom().session?.floorHolder === 'project-editor'
      : stage === 'discussion' ? d.elapsed >= 1 && !!d.floorHolder && w.mode === 'awaiting'
      : stage === 'work' ? w.elapsed >= 1 && w.status !== 'completed'
      : r.status === 'completed' && states.every(s => s && ['completed', 'cancelled'].includes(s.status));
    if (reached) return { routine: r, work: w, discussion: d };
    if (r.status === 'failed' || r.mode === 'waiting' || states.some(s => s?.status === 'failed' || s?.mode === 'waiting')) throw Error(`Studio failed or waiting: ${JSON.stringify({ r, states })}`);
    e.step();
  }
  throw Error(`Studio did not reach ${stage}`);
}, stage);
async function capture(page: Page, filename: string, work = false) {
  mkdirSync(artifacts, { recursive: true });
  await page.getByTestId(work ? 'continuation-work' : 'purposeful-routine-readout').scrollIntoViewIfNeeded();
  await page.evaluate(work => window.__marsEngine.camera(work ? [11, 3.2, -7] : [-3, 7, 10], work ? [8, .8, -4] : [-2, 1, 1]), work);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({ path: path.join(artifacts, filename) });
}
async function capturePair(page: Page, filename: string) {
  mkdirSync(artifacts, { recursive: true });
  const positions = await page.evaluate(() => {
    const e = window.__marsEngine, actors = e.purposefulRoutine()!.trip!.bindings.actors;
    return actors.map(id => e.state().humans.find(h => h.id === id)!.p);
  });
  const centre = positions[0].map((v, i) => (v + positions[1][i]) / 2);
  await page.evaluate(p => window.__marsEngine.camera([p[0] + 3, p[1] + 2.2, p[2] + 3.2], [p[0], p[1] + .8, p[2]]), centre);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({ path: path.join(artifacts, filename) });
}
async function clean(page: Page) {
  expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.heldItems())).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.slots().filter(s => s.claimedBy !== null))).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.records().filter(r => !['completed', 'cancelled'].includes(r.status)))).toEqual([]);
}
test('independent design studio reuses complete activities with its own people, objects and project', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await prepare(page);
  const epoch = await page.evaluate(() => window.__marsEngine.scenarioEpoch);
  const start = await page.evaluate(() => window.__marsEngine.state().tick);
  await button(page, 'Play').click();
  await page.waitForFunction(t => window.__marsEngine.state().tick >= t + 10, start);
  await button(page, 'Pause').click();
  await advance(page, 'question');
  await expect(page.getByTestId('purposeful-routine-readout')).toContainText('Question: asked');
  await capture(page, 'studio-critique.png');
  const discussing = await advance(page, 'discussion');
  expect(discussing.discussion.bindings.binding.kind).toBe('discussion');
  const working = await advance(page, 'work');
  expect(working.routine.progress.workElapsed).toBe(30);
  expect(working.routine.progress.restSeconds).toBe(3);
  const station = await page.evaluate(() => window.__marsEngine.workstation().state);
  expect('code' in station).toBe(false);
  if (!('code' in station)) { expect(station.user).toBe('ceramic-designer'); expect(station.task).toBe('Record critique decisions'); }
  await expect(page.getByTestId('continuation-work')).toContainText('ceramic-designer');
  await expect(button(page, 'Interrupt notes')).toBeDisabled();
  await expect(button(page, 'Resume notes')).toBeDisabled();
  await expect(button(page, 'Start notes')).toBeDisabled();
  await capture(page, 'studio-follow-up-work.png', true);
  const final = await advance(page, 'finished');
  expect(final.routine.progress.meal.every(m => m.served && m.consumed && m.returned)).toBe(true);
  expect(final.work.elapsed).toBe(12);
  expect(final.discussion.elapsed).toBe(20);
  await clean(page);
  expect(await page.evaluate(() => window.__marsEngine.scenarioEpoch)).toBe(epoch);
  expect(errors).toEqual([]);
});
test('studio local pause and terminal End preserve other commitments, then reset and switch back to Mars example bindings', async ({ page }) => {
  await prepare(page);
  await advance(page, 'work');
  await button(page, 'Pause work').click();
  const paused = await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) {
      const state = window.__marsEngine.gatheringContinuations().find(s => s?.bindings.binding.kind === 'work');
      if (state?.mode === 'paused') return state;
      window.__marsEngine.step();
    }
    throw Error('Studio follow-up did not safely pause');
  });
  expect(paused.elapsed).toBeGreaterThan(0);
  expect(paused.remaining).toBeGreaterThan(0);
  await expect(button(page, 'Interrupt notes')).toBeDisabled();
  await expect(button(page, 'Resume notes')).toBeDisabled();
  await button(page, 'End work').click();
  const final = await advance(page, 'finished');
  expect(final.work.status).toBe('cancelled');
  expect(final.routine.status).toBe('completed');
  expect(final.discussion.status).toBe('completed');
  await expect(page.getByTestId('continuation-work')).toContainText('remaining commitment was not fulfilled');
  await capture(page, 'studio-ended-follow-up.png', true);
  await clean(page);
  await button(page, 'Reset').click();
  expect(await page.evaluate(() => window.__marsEngine.gatheringContinuations())).toEqual([]);
  await page.getByRole('combobox', { name: 'Scenario', exact: true }).selectOption('work-break-4');
  await expect(page.getByTestId('purposeful-routine-hud')).toContainText('Sketch notes');
  expect((await page.evaluate(() => window.__marsEngine.activityExample()))?.roles.worker).toBe('worker');
});


test('studio shared lunch walk recovers actual reviewer crossing during Play and finishes the same intentions', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await prepare(page, true);
  const crossing = await page.evaluate(() => {
    for (let i = 0; i < 16000; i++) {
      const routine = window.__marsEngine.purposefulRoutine();
      if (routine?.trip?.diagnostic?.code === 'paired_walk.regroup-traffic') return routine.trip;
      if (routine?.mode === 'waiting' || routine?.status === 'failed') throw Error(JSON.stringify(routine));
      window.__marsEngine.step();
    }
    throw Error('Actual reviewer crossing was not exercised');
  });
  expect(crossing.mode).toBe('regrouping');
  expect(crossing.waitingReason).toContain('form-reviewer');
  await capturePair(page, 'studio-paired-regroup-wait.png');
  await button(page, 'Play').click();
  await page.waitForFunction(() => {
    const trip = window.__marsEngine.purposefulRoutine()?.trip;
    return trip?.mode === 'walking' && trip.participants.every(p => p.progress > 1);
  }, null, { timeout: 60_000 });
  await button(page, 'Pause').click();
  const walking = await page.evaluate(() => window.__marsEngine.purposefulRoutine()!.trip!);
  expect(walking.action).toBe(crossing.action);
  expect(walking.separation).toBeLessThanOrEqual(1.8);
  expect(walking.ownedActions.slice(0, crossing.ownedActions.length)).toEqual(crossing.ownedActions);
  await capturePair(page, 'studio-paired-walking.png');
  const final = await advance(page, 'finished');
  expect(final.routine.trip!.action).toBe(crossing.action);
  expect(final.routine.trip!.participants.every(p => p.arrived)).toBe(true);
  expect(final.routine.progress.meal.every(m => m.served && m.consumed && m.returned)).toBe(true);
  expect(final.routine.progress.workElapsed).toBe(30);
  expect(final.work.status).toBe('completed');
  expect(final.discussion.status).toBe('completed');
  await capture(page, 'studio-paired-returned-to-purpose.png', true);
  await clean(page); expect(errors).toEqual([]);
});
