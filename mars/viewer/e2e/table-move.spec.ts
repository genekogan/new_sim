/// <reference types="node" />
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
declare global { interface Window { __marsEngine: EngineHook } }
const artifacts = path.resolve('e2e/artifacts', process.env.E2E_RUN ?? 'table-move');
const settle = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
const finish = (page: Page, verb: string) => page.evaluate((name) => {
  for (let i = 0; i < 6000; i++) {
    const r = window.__marsEngine.records().filter((r) => r.verb === name).at(-1);
    if (r && ['completed', 'failed', 'cancelled'].includes(r.status)) return r;
    window.__marsEngine.step();
  }
  throw Error(`${name} did not finish`);
}, verb);
const untilMove = (page: Page, phase: string) => page.evaluate((wanted) => {
  for (let i = 0; i < 6000; i++) {
    const r = window.__marsEngine.fixtureMove();
    if (r?.phase === wanted) return r;
    if (r && ['completed', 'failed', 'cancelled'].includes(r.status)) throw Error(JSON.stringify(r));
    window.__marsEngine.step();
  }
  throw Error(`table never reached ${wanted}`);
}, phase);
for (const count of [4, 8]) test(`empty table moves with two people and remains usable in classroom ${count}`, async ({ page }) => {
  mkdirSync(artifacts, { recursive: true });
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/lab?scenario=classroom-${count}`); await page.waitForFunction(() => window.__marsEngine?.ready);
  await page.evaluate((n) => window.__marsEngine.runScenario(`classroom-${n}`, { paused: true }), count);
  const actor = page.getByRole('combobox', { name: 'Classroom participant' });
  await actor.selectOption('worker');
  const loadedHash = await page.evaluate(() => window.__marsEngine.stateHash());
  await page.getByRole('button', { name: 'Move empty table to side', exact: true }).click();
  await expect(page.getByTestId('table-move-feedback')).toContainText('move_fixture.contents');
  expect(await page.evaluate(() => window.__marsEngine.stateHash())).toBe(loadedHash);
  for (const name of ['bowl', 'spoon']) {
    await page.getByRole('button', { name: `Take ${name}`, exact: true }).click();
    expect((await finish(page, 'take_item')).status).toBe('completed');
  }
  const occupiedHandsHash = await page.evaluate(() => window.__marsEngine.stateHash());
  await page.getByRole('button', { name: 'Move empty table to side', exact: true }).click();
  await expect(page.getByTestId('table-move-feedback')).toContainText('move_fixture.hands-full');
  expect(await page.evaluate(() => window.__marsEngine.stateHash())).toBe(occupiedHandsHash);
  await actor.selectOption('guest1');
  await page.getByRole('combobox', { name: 'Table helper' }).selectOption('guest2');
  await page.getByRole('button', { name: 'Move empty table to side', exact: true }).click();
  await untilMove(page, 'move');
  await page.evaluate(() => window.__marsEngine.step(20));
  const held = await page.evaluate(() => ({ move: window.__marsEngine.fixtureMove(), table: window.__marsEngine.fixtures().find((e) => e.id === 'belongings-table'), actors: window.__marsEngine.state().humans.filter((e) => ['guest1', 'guest2'].includes(e.id)), hands: window.__marsEngine.heldItems() }));
  expect(held.table).toMatchObject({ def: 'table-6ft', support: 'held' });
  expect(held.hands.filter((h) => h.by === 'worker')).toHaveLength(2);
  await page.evaluate(() => { const e = window.__marsEngine.fixtures().find((e) => e.id === 'belongings-table')!; window.__marsEngine.camera([e.pose.p[0]+3, 2.8, e.pose.p[2]+4], [e.pose.p[0], 1, e.pose.p[2]]); });
  await settle(page); await page.screenshot({ path: path.join(artifacts, `table-${count}-held.png`) });
  await actor.selectOption('worker');
  const reservedHash = await page.evaluate(() => window.__marsEngine.stateHash());
  await page.getByRole('button', { name: 'Put belongings away', exact: true }).click();
  await expect(page.getByTestId('belongings-hud')).toContainText('stow.busy');
  expect(await page.evaluate(() => window.__marsEngine.stateHash())).toBe(reservedHash);
  await page.getByRole('button', { name: 'Stop moving table', exact: true }).click();
  expect((await finish(page, 'move_fixture')).status).toBe('cancelled');
  expect(await page.evaluate(() => window.__marsEngine.fixtures().find((e) => e.id === 'belongings-table')!.support)).toBe('ground');
  await settle(page); await page.screenshot({ path: path.join(artifacts, `table-${count}-cancelled.png`) });
  await actor.selectOption('guest1');
  await page.getByRole('button', { name: 'Move empty table to side', exact: true }).click();
  expect((await finish(page, 'move_fixture')).status).toBe('completed');
  const placed = await page.evaluate(() => window.__marsEngine.fixtures().find((e) => e.id === 'belongings-table'));
  expect(placed!.pose.p).toEqual([12, 0, -2]);
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) { if (window.__marsEngine.classroom().session?.phase === 'presenting') return; window.__marsEngine.step(); }
    throw Error('table crew never joined class');
  });
  await actor.selectOption('worker');
  await page.getByRole('button', { name: 'Put belongings away', exact: true }).click();
  expect((await finish(page, 'stow_items')).status).toBe('completed');
  expect(await page.evaluate(() => window.__marsEngine.heldItems())).toEqual([]);
  const returned = await page.evaluate(() => window.__marsEngine.components().filter((e) => e.id.startsWith('break-')));
  expect(returned.map((e) => e.support)).toEqual(['resting-on', 'resting-on']);
  for (const item of returned) { expect(item.pose.p[0]).toBeGreaterThan(11); expect(item.pose.p[2]).toBeGreaterThan(-3); expect(item.pose.p[1]).toBe(0.75); }
  await page.evaluate(() => window.__marsEngine.camera([15, 3.2, 2], [12, 0.8, -2]));
  await settle(page); await page.screenshot({ path: path.join(artifacts, `table-${count}-returned-objects.png`) });
  await page.getByRole('button', { name: 'Direct to courtyard', exact: true }).click();
  expect((await finish(page, 'walk_to')).status).toBe('completed');
  const ended = await page.evaluate(() => {
    for (let i = 0; i < 12000; i++) {
      const r = window.__marsEngine.records().filter((r) => r.verb === 'classroom_session').at(-1);
      if (r && ['completed', 'failed', 'cancelled'].includes(r.status)) return r;
      window.__marsEngine.step();
    }
    throw Error('classroom did not finish after table setup');
  });
  expect(ended.status).toBe('completed');
  expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual([]);
  expect((await page.evaluate(() => window.__marsEngine.records())).filter((r) => r.status === 'failed').map((r) => r.diagnostic?.code)).toEqual(['move_fixture.contents', 'move_fixture.hands-full', 'stow.busy']);
  expect(errors).toEqual([]);
  writeFileSync(path.join(artifacts, `table-${count}-proof.json`), JSON.stringify({ held, placed, returned, ended, errors }, null, 2));
});
