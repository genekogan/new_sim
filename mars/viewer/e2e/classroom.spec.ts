import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';

declare global { interface Window { __marsEngine: EngineHook } }
const settle = async (page: import('@playwright/test').Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
const artifacts = path.resolve(import.meta.dirname, 'artifacts', process.env.E2E_RUN!);
test('live classroom questions, speaker rotation and director intervention', async ({ page }) => {
  mkdirSync(artifacts, { recursive: true });
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/lab?scenario=classroom-4');
  await page.waitForFunction(() => window.__marsEngine?.ready);
  await page.evaluate(() => { window.__marsEngine.runScenario('classroom-4', { paused: true }); });
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  await page.evaluate(() => {
    for (let i = 0; i < 2400 && window.__marsEngine.classroom().session?.phase !== 'presenting'; i++) window.__marsEngine.step();
  });
  await expect(page.getByTestId('classroom-hud')).toContainText('presenting');
  const first = await page.evaluate(() => window.__marsEngine.classroom());
  expect(first.session?.floorHolder).toBe('presenter1');
  await page.evaluate(() => window.__marsEngine.step(15));
  await settle(page);
  await page.screenshot({ path: path.join(artifacts, 'classroom-presenting.png') });
  await page.getByRole('button', { name: 'Ask question', exact: true }).click();
  await page.evaluate(() => window.__marsEngine.step(25));
  const question = await page.evaluate(() => ({ ...window.__marsEngine.classroom(), attention: window.__marsEngine.classroomAttention() }));
  expect(question.session?.phase).toBe('question'); expect(question.session?.attentionTarget?.actor).toBe('guest1');
  expect(question.attention.some((a) => Math.abs(a.turn) > 0.05)).toBeTruthy();
  await expect(page.getByTestId('classroom-hud')).toContainText('live classroom · question');
  await settle(page);
  await page.screenshot({ path: path.join(artifacts, 'classroom-question.png') });
  await page.getByRole('button', { name: 'Direct to courtyard', exact: true }).click();
  await page.evaluate(() => window.__marsEngine.step(200));
  expect((await page.evaluate(() => window.__marsEngine.classroom())).session?.participants.find((p) => p.actor === 'guest1')?.state).toBe('excluded');
  await page.getByRole('button', { name: 'Next presenter', exact: true }).click();
  await page.evaluate(() => {
    for (let i = 0; i < 2400 && (window.__marsEngine.classroom().session?.floorHolder !== 'presenter2' || window.__marsEngine.classroom().session?.phase !== 'presenting'); i++) window.__marsEngine.step();
    window.__marsEngine.step(15);
  });
  await expect(page.getByTestId('classroom-hud')).toContainText('Floor: presenter2');
  await settle(page);
  await page.screenshot({ path: path.join(artifacts, 'classroom-rotation.png') });
  await page.getByRole('button', { name: 'End session', exact: true }).click();
  await page.evaluate(() => window.__marsEngine.step(100));
  const ended = await page.evaluate(() => ({ ...window.__marsEngine.classroom(), state: window.__marsEngine.state() }));
  expect(ended.session?.phase).toBe('ended'); expect(ended.state.checks.every((c) => c.ok)).toBeTruthy();
  expect(await page.evaluate(() => window.__marsEngine.records().filter((r) => r.status === 'failed'))).toEqual([]); expect(errors).toEqual([]);
  writeFileSync(path.join(artifacts, 'classroom-proof.json'), JSON.stringify({ first, question, ended, errors }, null, 2));
});

test('eight guests transition into smaller conversations and leave cleanly', async ({ page }) => {
  mkdirSync(artifacts, { recursive: true });
  await page.goto('/lab?scenario=classroom-8');
  await page.waitForFunction(() => window.__marsEngine?.ready);
  await page.evaluate(() => window.__marsEngine.runScenario('classroom-8', { paused: true }));
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  await page.evaluate(() => {
    for (let i = 0; i < 6000 && window.__marsEngine.classroom().session?.phase !== 'conversing'; i++) window.__marsEngine.step();
    for (let i = 0; i < 2000 && window.__marsEngine.records().filter((r) => r.verb === 'converse' && r.phase === 'talking' && r.status === 'executing').length !== 3; i++) window.__marsEngine.step();
  });
  expect(await page.evaluate(() => window.__marsEngine.records().filter((r) => r.verb === 'converse' && r.phase === 'talking' && r.status === 'executing').length)).toBe(3);
  await expect(page.getByTestId('classroom-hud')).toContainText('conversing');
  await settle(page);
  await page.screenshot({ path: path.join(artifacts, 'classroom-eight-conversations.png') });
  await page.evaluate(() => {
    for (let i = 0; i < 6000 && window.__marsEngine.classroom().session?.phase !== 'ended'; i++) window.__marsEngine.step();
  });
  const ended = await page.evaluate(() => ({ ...window.__marsEngine.classroom(), state: window.__marsEngine.state() }));
  expect(ended.session?.phase).toBe('ended'); expect(ended.state.checks.every((c) => c.ok)).toBeTruthy();
  expect(await page.evaluate(() => window.__marsEngine.records().filter((r) => r.status === 'failed'))).toEqual([]);
  writeFileSync(path.join(artifacts, 'classroom-eight-proof.json'), JSON.stringify(ended, null, 2));
});
