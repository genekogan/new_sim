/// <reference types="node" />
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
declare global { interface Window { __marsEngine: EngineHook } }
const artifacts = path.resolve('e2e/artifacts', process.env.E2E_RUN ?? 'room-setup');
const finish = (page: Page, verb: string, actor?: string) => page.evaluate(({ v, actor }) => {
  for (let i = 0; i < 12000; i++) {
    const rec = window.__marsEngine.records().filter((r) => r.verb === v && (!actor || r.params.actor === actor)).at(-1);
    if (rec && ['completed', 'failed', 'cancelled'].includes(rec.status)) return rec;
    window.__marsEngine.step();
  }
  throw Error(`${v} did not finish`);
}, { v: verb, actor });
const capture = async (page: Page, name: string) => {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({ path: path.join(artifacts, name) });
};
for (const count of [4, 8]) test(`bounded room layout can stop, retry and host the whole classroom journey ${count}`, async ({ page }) => {
  mkdirSync(artifacts, { recursive: true });
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/lab?scenario=classroom-${count}`);
  await page.waitForFunction(() => window.__marsEngine?.ready);
  await page.evaluate((n) => window.__marsEngine.runScenario(`classroom-${n}`, { paused: true }), count);
  const actor = page.getByRole('combobox', { name: 'Classroom participant' });
  const hash = await page.evaluate(() => window.__marsEngine.stateHash());
  await page.getByRole('button', { name: 'Prepare side layout', exact: true }).click();
  await expect(page.getByTestId('room-setup-feedback')).toContainText('setup_room.preflight');
  expect(await page.evaluate(() => window.__marsEngine.stateHash())).toBe(hash);
  await actor.selectOption('worker');
  for (const item of ['bowl', 'spoon']) {
    await page.getByRole('button', { name: `Take ${item}`, exact: true }).click();
    expect((await finish(page, 'take_item')).status).toBe('completed');
  }
  await page.getByRole('button', { name: 'Prepare side layout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start session', exact: true })).toBeDisabled();
  await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) { if (window.__marsEngine.fixtureMove()?.phase === 'move') return; window.__marsEngine.step(); }
    throw Error('layout table never carried');
  });
  await page.evaluate(() => window.__marsEngine.step(20));
  await page.evaluate(() => { const e = window.__marsEngine.fixtures().find((e) => e.id === 'belongings-table')!; window.__marsEngine.camera([e.pose.p[0] + 3, 3, e.pose.p[2] + 4], [e.pose.p[0], 1, e.pose.p[2]]); });
  await capture(page, `setup-${count}-carrying-table.png`);
  await page.getByRole('button', { name: 'Stop room setup', exact: true }).click();
  expect((await finish(page, 'setup_room')).status).toBe('cancelled');
  expect(await page.evaluate(() => window.__marsEngine.fixtures().find((e) => e.id === 'belongings-table')!.support)).toBe('ground');
  await page.getByRole('button', { name: 'Prepare side layout', exact: true }).click();
  const setup = await finish(page, 'setup_room');
  expect(setup.status).toBe('completed');
  await expect(page.getByTestId('room-setup-progress')).toContainText('ready for a session');
  const chair = count === 4 ? 'seat8' : 'seat12';
  const placed = await page.evaluate(() => window.__marsEngine.fixtures());
  expect(placed.find((e) => e.id === chair)!.pose.p).toEqual([7.5, 0, count === 8 ? 4.5 : 3]);
  expect(placed.find((e) => e.id === 'belongings-table')!.pose.p).toEqual([12, 0, -2]);
  await page.evaluate(() => window.__marsEngine.cameraPreset('oblique'));
  await capture(page, `setup-${count}-ready.png`);
  await page.getByRole('button', { name: 'Restore default layout', exact: true }).click();
  expect((await finish(page, 'setup_room')).status).toBe('completed');
  const restored = await page.evaluate(() => window.__marsEngine.fixtures());
  expect(restored.find((e) => e.id === chair)!.pose.p).toEqual([4.5, 0, count === 8 ? 6 : 3]);
  expect(restored.find((e) => e.id === 'belongings-table')!.pose.p).toEqual([10, 0, -5]);
  await page.getByRole('button', { name: 'Prepare side layout', exact: true }).click();
  expect((await finish(page, 'setup_room')).status).toBe('completed');
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) { if (window.__marsEngine.classroom().session?.phase === 'presenting') return; window.__marsEngine.step(); }
    throw Error('prepared room never presented');
  });
  await actor.selectOption('visitor');
  await page.getByRole('button', { name: 'Join session', exact: true }).click();
  const visitor = await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) {
      const p = window.__marsEngine.classroom().session?.participants.find((p) => p.actor === 'visitor');
      if (p?.arrival === 'seated') return p;
      window.__marsEngine.step();
    }
    throw Error('visitor never used prepared spare chair');
  });
  expect(visitor.seat).toBe(`${chair}#seat`);
  await page.getByRole('button', { name: 'Ask question', exact: true }).click();
  await page.evaluate(() => {
    for (let i = 0; i < 3000; i++) { const s = window.__marsEngine.classroom().session; if (s?.phase === 'question' && s.floorHolder === 'visitor') return; window.__marsEngine.step(); }
    throw Error('visitor never held the floor');
  });
  await capture(page, `setup-${count}-question.png`);
  const rotated = await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) {
      const s = window.__marsEngine.classroom().session;
      if (s?.phase === 'presenting' && s.floorHolder === 'presenter2') return s;
      window.__marsEngine.step();
    }
    throw Error('prepared room never presented the second talk');
  });
  await actor.selectOption('worker');
  await page.getByRole('button', { name: 'Put belongings away', exact: true }).click();
  expect((await finish(page, 'stow_items')).status).toBe('completed');
  await page.getByRole('button', { name: 'Direct to courtyard', exact: true }).click();
  expect((await finish(page, 'walk_to', 'worker')).status).toBe('completed');
  const conversations = await page.evaluate(() => {
    for (let i = 0; i < 12000; i++) {
      const s = window.__marsEngine.classroom().session;
      if (s?.phase === 'conversing' && s.groups.length > 0 && s.groups.every((g) =>
        g.status === 'talking' && !!g.floorHolder && g.members.includes(g.floorHolder) &&
        g.attentionTarget?.actor === g.floorHolder)) return s;
      const rec = window.__marsEngine.records().filter((r) => r.verb === 'classroom_session').at(-1);
      if (rec && ['completed', 'failed', 'cancelled'].includes(rec.status)) throw Error('session ended before formed conversations');
      window.__marsEngine.step();
    }
    throw Error('prepared room never formed conversations with a shared floor');
  });
  await capture(page, `setup-${count}-conversations.png`);
  const ended = await finish(page, 'classroom_session');
  expect(ended.status).toBe('completed');
  expect(await page.evaluate(() => window.__marsEngine.heldItems())).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual([]);
  expect((await page.evaluate(() => window.__marsEngine.records())).filter((r) => r.status === 'failed').map((r) => r.diagnostic?.code)).toEqual(['setup_room.preflight']);
  expect(await page.evaluate(() => window.__marsEngine.slots().filter((s) => s.claimedBy !== null))).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.records().filter((r) =>
    ['setup_room', 'move_fixture', 'classroom_session', 'converse', 'walk_to', 'take_slot', 'sit', 'stand', 'stow_items'].includes(r.verb) &&
    !['completed', 'failed', 'cancelled'].includes(r.status)))).toEqual([]);
  expect(errors).toEqual([]);
  writeFileSync(path.join(artifacts, `setup-${count}-proof.json`), JSON.stringify({ setup, placed, visitor, rotated, conversations, ended, errors }, null, 2));
  await page.getByRole('button', { name: 'Load 8-guest room', exact: true }).click();
  await page.getByText('Choose setup crew', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Room chair carrier', exact: true }).selectOption('guest8');
  await page.getByRole('button', { name: 'Load 4-guest room', exact: true }).click();
  await page.getByText('Choose setup crew', { exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Room chair carrier', exact: true })).toHaveValue('guest3');
});
