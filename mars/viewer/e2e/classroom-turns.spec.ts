/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
declare global { interface Window { __marsEngine: EngineHook } }
const artifacts = path.resolve(import.meta.dirname, 'artifacts', process.env.E2E_RUN!);
const settle = async (page: import('@playwright/test').Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
test('physically formed classroom groups share changing floor and bounded head attention', async ({ page }) => {
  mkdirSync(artifacts, { recursive: true });
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/lab?scenario=classroom-4'); await page.waitForFunction(() => window.__marsEngine?.ready);
  await page.evaluate(() => window.__marsEngine.runScenario('classroom-4', { paused: true }));
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) {
      const groups = window.__marsEngine.classroom().session?.groups;
      if (groups?.length === 2 && groups.every((g) => g.status === 'talking' && !!g.floorHolder)) break;
      window.__marsEngine.step();
    }
    window.__marsEngine.camera([9, 3.5, 10], [7, 1, 6]);
  });
  const first = await page.evaluate(() => ({ classroom: window.__marsEngine.classroom(), poses: window.__marsEngine.state().humans, attention: window.__marsEngine.classroomAttention() }));
  expect(first.classroom.session?.groups.length).toBe(2);
  expect(first.classroom.session?.groups.every((g) => g.status === 'talking' && g.members.includes(g.floorHolder!))).toBeTruthy();
  await expect(page.getByTestId('conversation-floors')).toContainText('talking');
  await settle(page); await page.screenshot({ path: path.join(artifacts, 'conversation-turn-one.png') });
  await page.evaluate(() => window.__marsEngine.step(82));
  await settle(page);
  const second = await page.evaluate(() => ({ classroom: window.__marsEngine.classroom(), poses: window.__marsEngine.state().humans, attention: window.__marsEngine.classroomAttention() }));
  expect(second.classroom.session?.groups.some((g, i) => g.floorHolder !== first.classroom.session!.groups[i].floorHolder)).toBeTruthy();
  expect(second.classroom.session?.groups.every((g) => g.status === 'talking' && g.members.includes(g.floorHolder!))).toBeTruthy();
  expect(second.poses.map((a) => [a.id, a.p, a.yaw])).toEqual(first.poses.map((a) => [a.id, a.p, a.yaw]));
  expect(second.attention.some((a) => Math.abs(a.turn) > 0.05)).toBeTruthy();
  await page.screenshot({ path: path.join(artifacts, 'conversation-turn-two.png') });
  const actor = second.classroom.session!.groups.find((g) => g.members.every((a) => a.startsWith('guest')))!.floorHolder!;
  await page.getByRole('combobox', { name: 'Classroom participant' }).selectOption(actor);
  await page.getByRole('button', { name: 'Leave session', exact: true }).click();
  await page.evaluate(() => window.__marsEngine.step(160));
  const departed = await page.evaluate(() => window.__marsEngine.classroom());
  expect(departed.session?.groups.every((g) => !g.members.includes(actor) && g.floorHolder !== actor && g.attentionTarget?.actor !== actor)).toBeTruthy();
  await page.getByRole('button', { name: 'End session', exact: true }).click(); await page.evaluate(() => window.__marsEngine.step(100));
  const ended = await page.evaluate(() => window.__marsEngine.classroom());
  expect(ended.session?.groups.every((g) => !g.floorHolder && !g.attentionTarget)).toBeTruthy();
  expect(await page.evaluate(() => window.__marsEngine.records().filter((r) => r.status === 'failed'))).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.slots().filter((s) => s.claimedBy !== null))).toEqual([]); expect(errors).toEqual([]);
  writeFileSync(path.join(artifacts, 'conversation-turns-proof.json'), JSON.stringify({ first, second, departed, ended, errors }, null, 2));
});
