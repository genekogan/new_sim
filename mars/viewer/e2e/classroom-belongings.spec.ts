import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
declare global { interface Window { __marsEngine: EngineHook } }
const artifacts = path.resolve('e2e/artifacts', process.env.E2E_RUN ?? 'classroom-belongings');
const settle = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
const finish = (page: Page, verb: string) => page.evaluate((name) => {
  for (let i = 0; i < 6000; i++) {
    const r = window.__marsEngine.records().filter((a) => a.verb === name).at(-1);
    if (r && ['completed', 'cancelled', 'failed'].includes(r.status)) return r;
    window.__marsEngine.step();
  }
  throw Error(`activity ${name} did not finish`);
}, verb);
const take = async (page: Page, name: 'bowl' | 'spoon') => {
  await page.getByRole('button', { name: `Take ${name}`, exact: true }).click();
  expect((await finish(page, 'take_item')).status).toBe('completed');
};

test('unfinished work survives held-item refusals, interrupted preparation and explicit return', async ({ page }) => {
  mkdirSync(artifacts, { recursive: true });
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/lab?scenario=classroom-4'); await page.waitForFunction(() => window.__marsEngine?.ready);
  await page.evaluate(() => window.__marsEngine.runScenario('classroom-4', { paused: true }));
  await page.getByRole('combobox', { name: 'Classroom participant' }).selectOption('worker');
  await page.getByRole('button', { name: 'Work on Sketch notes', exact: true }).click();
  await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) {
      const s = window.__marsEngine.workstation().state;
      if (!('code' in s) && s.elapsed >= 1) return;
      window.__marsEngine.step();
    }
    throw Error('work never started');
  });
  await page.getByRole('button', { name: 'Interrupt work', exact: true }).click();
  expect((await finish(page, 'work_at')).status).toBe('cancelled');
  const unfinished = await page.evaluate(() => window.__marsEngine.workstation().state);
  expect('code' in unfinished).toBe(false);
  await take(page, 'bowl'); await take(page, 'spoon');
  expect((await page.evaluate(() => window.__marsEngine.heldItems())).filter((i) => i.by === 'worker')).toHaveLength(2);
  await page.evaluate(() => window.__marsEngine.camera([12, 2.8, -2], [10, 1, -5]));
  await settle(page); await page.screenshot({ path: path.join(artifacts, 'worker-holding-belongings.png') });
  const heldHash = await page.evaluate(() => window.__marsEngine.stateHash());
  await page.getByRole('button', { name: 'Resume Sketch notes', exact: true }).click();
  await expect(page.getByTestId('classroom-feedback')).toContainText('workstation.hands-occupied');
  expect(await page.evaluate(() => window.__marsEngine.stateHash())).toBe(heldHash);
  await page.getByRole('button', { name: 'Put belongings away', exact: true }).click();
  await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) {
      const r = window.__marsEngine.records().filter((a) => a.verb === 'put_item').at(-1);
      if (r?.phase === 'reach' && r.status === 'executing') return;
      window.__marsEngine.step();
    }
    throw Error('put never reached transfer phase');
  });
  await settle(page); await page.screenshot({ path: path.join(artifacts, 'belongings-first-reach.png') });
  await page.getByRole('button', { name: 'Stop putting away', exact: true }).click();
  expect((await finish(page, 'stow_items')).status).toBe('cancelled');
  expect((await page.evaluate(() => window.__marsEngine.heldItems())).filter((i) => i.by === 'worker')).toHaveLength(2);
  await settle(page); await page.screenshot({ path: path.join(artifacts, 'belongings-cancelled-before-release.png') });
  await page.getByRole('button', { name: 'Put belongings away', exact: true }).click();
  expect((await finish(page, 'stow_items')).status).toBe('completed');
  expect(await page.evaluate(() => window.__marsEngine.heldItems())).toEqual([]);
  const placed = await page.evaluate(() => window.__marsEngine.components().filter((c) => c.id.startsWith('break-')));
  expect(placed.map((c) => c.support)).toEqual(['resting-on', 'resting-on']);
  await settle(page); await page.screenshot({ path: path.join(artifacts, 'belongings-returned-to-table.png') });
  await page.getByRole('button', { name: 'Resume Sketch notes', exact: true }).click();
  expect((await finish(page, 'work_at')).status).toBe('completed');
  const completed = await page.evaluate(() => window.__marsEngine.workstation().state);
  expect(completed).toMatchObject({ status: 'completed', user: 'worker', task: 'Sketch notes', duration: 30, elapsed: 30 });
  expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual([]);
  expect((await page.evaluate(() => window.__marsEngine.records())).filter((r) => r.status === 'failed').map((r) => r.diagnostic?.code)).toEqual(['workstation.hands-occupied']);
  expect(errors).toEqual([]);
  writeFileSync(path.join(artifacts, 'belongings-work-proof.json'), JSON.stringify({ unfinished, completed, placed, errors }, null, 2));
});

test('a visitor can return shared belongings and join the eight-person classroom', async ({ page }) => {
  await page.goto('/lab?scenario=classroom-8'); await page.waitForFunction(() => window.__marsEngine?.ready);
  await page.evaluate(() => window.__marsEngine.runScenario('classroom-8', { paused: true }));
  await page.getByRole('combobox', { name: 'Classroom participant' }).selectOption('visitor');
  await take(page, 'bowl'); await take(page, 'spoon');
  await page.getByRole('button', { name: 'Put belongings away', exact: true }).click();
  expect((await finish(page, 'stow_items')).status).toBe('completed');
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  await page.evaluate(() => {
    for (let i = 0; i < 6000 && window.__marsEngine.classroom().session?.phase !== 'presenting'; i++) window.__marsEngine.step();
  });
  await page.getByRole('button', { name: 'Join session', exact: true }).click();
  await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) {
      if (window.__marsEngine.classroom().session?.participants.find((p) => p.actor === 'visitor')?.arrival === 'seated') return;
      window.__marsEngine.step();
    }
    throw Error('prepared visitor never seated');
  });
  expect(await page.evaluate(() => window.__marsEngine.heldItems())).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual([]);
  expect((await page.evaluate(() => window.__marsEngine.records())).filter((r) => r.status === 'failed')).toEqual([]);
  mkdirSync(artifacts, { recursive: true });
  await settle(page); await page.screenshot({ path: path.join(artifacts, 'prepared-visitor-seated.png') });
});
