/// <reference types="node" />
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
declare global { interface Window { __marsEngine: EngineHook } }
const artifacts = path.resolve('e2e/artifacts', process.env.E2E_RUN ?? 'quiet-rest');
const watchErrors = (page: Page) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
};
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const load = async (page: Page, count = 4) => {
  await page.goto(`/lab?scenario=work-break-${count}`);
  await page.waitForFunction(() => window.__marsEngine?.ready);
  await page.evaluate(n => window.__marsEngine.runScenario(`work-break-${n}`, { paused: true }), count);
};
const finish = (page: Page, verb: string) => page.evaluate(v => {
  for (let i = 0; i < 12000; i++) {
    const r = window.__marsEngine.records().filter(r => r.verb === v && !r.parent).at(-1);
    if (r && ['completed', 'cancelled', 'failed'].includes(r.status)) return r;
    window.__marsEngine.step();
  }
  throw Error(`${v} never finished`);
}, verb);
const sitPhase = (page: Page, phase: string) => page.evaluate(phase => {
  for (let i = 0; i < 6000; i++) {
    const r = window.__marsEngine.records().filter(r => r.verb === 'sit' && !r.parent && r.params.actor === 'worker').at(-1);
    if (r?.phase === phase) return r;
    if (r && ['failed', 'cancelled', 'completed'].includes(r.status)) throw Error(`rest ended before ${phase}: ${JSON.stringify(r)}`);
    window.__marsEngine.step();
  }
  throw Error(`rest never reached ${phase}`);
}, phase);
const capture = async (page: Page, name: string, work = false) => {
  mkdirSync(artifacts, { recursive: true });
  await page.getByTestId(work ? 'break-work-readout' : 'quiet-rest-hud').scrollIntoViewIfNeeded();
  await page.evaluate(work => {
    const w = window.__marsEngine.state().humans.find(h => h.id === 'worker')!;
    if (work) window.__marsEngine.camera([9, 3.2, -8], [6, .8, -5]);
    else window.__marsEngine.camera([w.p[0] + 3, 3.2, w.p[2] - 3], [w.p[0], 1, w.p[2]]);
  }, work);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({ path: path.join(artifacts, name) });
};
const noLeaks = async (page: Page) => {
  expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.slots().filter(s => s.claimedBy !== null))).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.heldItems())).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.records().filter(r => !['completed', 'cancelled', 'failed'].includes(r.status)))).toEqual([]);
};
for (const count of [4, 8]) test(`quiet rest after shared food preserves same notes in ${count}-guest room`, async ({ page }) => {
  const errors = watchErrors(page);
  await load(page, count);
  const epoch = await page.evaluate(() => window.__marsEngine.scenarioEpoch);
  if (count === 8) {
    for (const item of ['bowl', 'spoon']) {
      await button(page, `Take ${item}`).click(); expect((await finish(page, 'take_item')).status).toBe('completed');
    }
    await expect(button(page, 'Rest quietly')).toBeDisabled();
    await expect(page.getByTestId('quiet-rest-hud')).toContainText('Return utensils first: break-bowl, break-spoon');
    await button(page, 'Prepare side layout').click(); expect((await finish(page, 'setup_room')).status).toBe('completed');
    await button(page, 'Put belongings away').click(); expect((await finish(page, 'stow_items')).status).toBe('completed');
    await page.evaluate(() => window.__marsEngine.step(2));
  }
  await button(page, 'Start notes').click();
  await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) { const w = window.__marsEngine.workstation().state; if (!('code' in w) && w.elapsed >= 2) return; window.__marsEngine.step(); }
    throw Error('notes did not progress');
  });
  await button(page, 'Interrupt notes').click(); expect((await finish(page, 'work_at')).status).toBe('cancelled');
  const unfinished = await page.evaluate(() => window.__marsEngine.workstation().state);
  await button(page, 'Start shared food break').click(); expect((await finish(page, 'shared_food_break')).status).toBe('completed');
  await page.evaluate(() => window.__marsEngine.step(2));
  expect(await page.evaluate(() => window.__marsEngine.sharedFood().at(-1)?.participants.every(p => !p.held.length && p.returned.length === 2 && p.food === 0))).toBe(true);
  await button(page, 'Rest quietly').click(); const rest = await sitPhase(page, 'occupied');
  const seat = `seat${count === 4 ? 8 : 12}#seat`;
  expect(rest.params).toMatchObject({ actor: 'worker', slot: seat });
  expect(await page.evaluate(seat => window.__marsEngine.slots().find(s => s.id === seat), seat)).toMatchObject({ occupant: 'worker', claimedBy: rest.id, p: count === 4 ? [4.5, 3] : [7.5, 4.5] });
  await expect(page.getByTestId('quiet-rest-readout')).toContainText('Resting quietly');
  await expect(button(page, 'Resume notes')).toBeDisabled();
  await page.evaluate(() => window.__marsEngine.step(60));
  expect(await page.evaluate(() => window.__marsEngine.workstation().state)).toEqual(unfinished);
  await capture(page, `quiet-rest-${count}-seated.png`);
  await button(page, 'Get up from rest').click();
  await expect(page.getByTestId('quiet-rest-readout')).toContainText('waiting for safe seat release');
  expect(await page.evaluate(seat => window.__marsEngine.slots().find(s => s.id === seat)?.claimedBy, seat)).toBe(rest.id);
  expect((await finish(page, 'stand')).status).toBe('completed');
  await page.evaluate(() => window.__marsEngine.step(2));
  expect(await page.evaluate(() => window.__marsEngine.workstation().state)).toEqual(unfinished);
  await button(page, 'Resume notes').click();
  const resumed = await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) { const w = window.__marsEngine.workstation().state; if (!('code' in w) && w.phase === 'working') return w; window.__marsEngine.step(); }
    throw Error('same notes did not resume');
  });
  expect(resumed).toMatchObject({ task: 'Sketch notes', user: 'worker', duration: 30 });
  expect(!('code' in unfinished) && resumed.elapsed >= unfinished.elapsed).toBe(true);
  await capture(page, `quiet-rest-${count}-resumed.png`, true);
  expect((await finish(page, 'work_at')).status).toBe('completed');
  expect(await page.evaluate(() => window.__marsEngine.workstation().state)).toMatchObject({ status: 'completed', elapsed: 30 });
  expect(await page.evaluate(() => window.__marsEngine.scenarioEpoch)).toBe(epoch);
  expect(await page.evaluate(() => window.__marsEngine.records().filter(r => r.status === 'failed'))).toEqual([]);
  await noLeaks(page); expect(errors).toEqual([]);
  writeFileSync(path.join(artifacts, `quiet-rest-${count}-proof.json`), JSON.stringify({ epoch, unfinished, rest, resumed, errors }, null, 2));
});
test('rest refuses reserved and occupied classroom seating without controlling foreign occupants; reset clears stale IDs', async ({ page }) => {
  const errors = watchErrors(page);
  await load(page);
  await button(page, 'Start session').click();
  await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) { if (window.__marsEngine.classroom().session?.phase === 'presenting') return; window.__marsEngine.step(); }
    throw Error('classroom never presented');
  });
  await page.getByRole('combobox', { name: 'Classroom participant', exact: true }).selectOption('visitor');
  await button(page, 'Join session').click();
  await page.evaluate(() => {
    for (let i = 0; i < 100; i++) { if (window.__marsEngine.slots().find(s => s.id === 'seat8#seat')?.claimedBy) return; window.__marsEngine.step(); }
    throw Error('spare seat was not reserved for visitor');
  });
  const reserved = await page.evaluate(() => ({ hash: window.__marsEngine.stateHash(), slot: window.__marsEngine.slots().find(s => s.id === 'seat8#seat') }));
  await button(page, 'Rest quietly').click();
  await expect(page.getByTestId('quiet-rest-feedback')).toContainText('reservation.conflict');
  expect(await page.evaluate(() => window.__marsEngine.stateHash())).toBe(reserved.hash);
  expect(await page.evaluate(() => window.__marsEngine.slots().find(s => s.id === 'seat8#seat'))).toEqual(reserved.slot);
  await expect(button(page, 'Get up from rest')).toBeDisabled(); await expect(button(page, 'Stop quiet rest')).toBeDisabled();
  await page.getByRole('button', { name: /^Dismiss refusal / }).click();
  await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) { if (window.__marsEngine.classroom().session?.participants.find(p => p.actor === 'visitor')?.arrival === 'seated') return; window.__marsEngine.step(); }
    throw Error('visitor never physically seated');
  });
  const occupied = await page.evaluate(() => ({ hash: window.__marsEngine.stateHash(), slot: window.__marsEngine.slots().find(s => s.id === 'seat8#seat') }));
  expect(occupied.slot?.occupant).toBe('visitor');
  await button(page, 'Rest quietly').click();
  await expect(page.getByTestId('quiet-rest-feedback')).toContainText('reservation.conflict');
  expect(await page.evaluate(() => window.__marsEngine.stateHash())).toBe(occupied.hash);
  expect(await page.evaluate(() => window.__marsEngine.slots().find(s => s.id === 'seat8#seat'))).toEqual(occupied.slot);
  await page.getByRole('button', { name: /^Dismiss refusal / }).click();
  await button(page, 'End session').click(); expect((await finish(page, 'classroom_session')).status).toBe('cancelled');
  await noLeaks(page);
  expect(await page.evaluate(() => window.__marsEngine.records().filter(r => r.status === 'failed').map(r => r.diagnostic?.code))).toEqual(['reservation.conflict', 'reservation.conflict']);
  await button(page, 'Rest quietly').click(); await sitPhase(page, 'occupied');
  const epoch = await page.evaluate(() => window.__marsEngine.scenarioEpoch);
  await button(page, 'Reset').click();
  await page.waitForFunction(epoch => window.__marsEngine.scenarioEpoch !== epoch, epoch);
  await expect(page.getByTestId('quiet-rest-readout')).toContainText('Ready for explicit seated rest');
  await expect(button(page, 'Stop quiet rest')).toBeDisabled(); await expect(button(page, 'Get up from rest')).toBeDisabled();
  expect(await page.evaluate(() => window.__marsEngine.records())).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.slots().filter(s => s.claimedBy !== null))).toEqual([]);
  await page.evaluate(() => window.__marsEngine.runScenario('classroom-4', { paused: true }));
  await expect(page.getByTestId('quiet-rest-hud')).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('quiet rest cancellation and temporary directive respect physical release; permanent departure gets up first', async ({ page }) => {
  const errors = watchErrors(page);
  for (const phase of ['approach', 'sit-down', 'occupied', 'stand-up']) {
    await load(page);
    await button(page, 'Rest quietly').click();
    if (phase === 'stand-up') {
      await sitPhase(page, 'occupied'); await button(page, 'Get up from rest').click(); await sitPhase(page, 'stand-up');
    } else await sitPhase(page, phase);
    await button(page, 'Stop quiet rest').click();
    if (phase !== 'approach') expect(await page.evaluate(() => window.__marsEngine.slots().find(s => s.id === 'seat8#seat')?.claimedBy)).not.toBeNull();
    expect((await finish(page, 'sit')).status).toBe('cancelled');
    await page.evaluate(() => window.__marsEngine.step(2));
    await noLeaks(page);
    expect(await page.evaluate(() => window.__marsEngine.records().filter(r => r.status === 'failed'))).toEqual([]);
  }
  await load(page);
  await button(page, 'Rest quietly').click(); const source = await sitPhase(page, 'occupied');
  await button(page, 'Direct to courtyard').click();
  const yielding = await page.evaluate(() => ({ slot: window.__marsEngine.slots().find(s => s.id === 'seat8#seat'), directive: window.__marsEngine.records().filter(r => r.verb === 'walk_to' && !r.parent).at(-1) }));
  expect(yielding.slot?.claimedBy).toBe(source.id); expect(yielding.directive?.phase).toBe('pre-empting');
  await expect(button(page, 'Rest quietly')).toBeDisabled();
  await page.evaluate(id => {
    for (let i = 0; i < 60; i++) {
      const source = window.__marsEngine.records().find(r => r.id === id);
      if (source?.status === 'cancelled' && window.__marsEngine.state().humans.find(h => h.id === 'worker')?.activity === 'walk') return;
      window.__marsEngine.step();
    }
    throw Error('temporary directive did not take over after safe stand-up');
  }, source.id);
  await expect(button(page, 'Rest quietly')).toBeDisabled();
  expect((await finish(page, 'walk_to')).status).toBe('completed');
  const returned = await sitPhase(page, 'occupied');
  expect(returned.id).toBe(`${source.id}:resume:${yielding.directive!.id}`);
  await expect(page.getByTestId('quiet-rest-readout')).toContainText('Resting quietly');
  await expect(button(page, 'Get up from rest')).toBeEnabled();
  await button(page, 'Get up from rest').click(); expect((await finish(page, 'stand')).status).toBe('completed');
  await button(page, 'Direct to courtyard').click(); expect((await finish(page, 'walk_to')).status).toBe('completed');
  await page.evaluate(() => window.__marsEngine.step(200));
  expect(await page.evaluate(() => window.__marsEngine.state().humans.find(h => h.id === 'worker')?.p)).toEqual([12, 0, 10]);
  expect(await page.evaluate(() => window.__marsEngine.records().filter(r => r.verb === 'sit' && !r.parent).map(r => r.id))).toEqual([source.id, returned.id]);
  await noLeaks(page);
  expect(await page.evaluate(() => window.__marsEngine.records().filter(r => r.status === 'failed'))).toEqual([]);
  expect(errors).toEqual([]);
});
