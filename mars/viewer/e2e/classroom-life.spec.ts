/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
declare global { interface Window { __marsEngine: EngineHook } }
const artifacts = path.resolve(import.meta.dirname, 'artifacts', process.env.E2E_RUN!);
const settle = async (page: import('@playwright/test').Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
const boot = async (page: import('@playwright/test').Page) => { await page.goto('/lab?scenario=classroom-4'); await page.waitForFunction(() => window.__marsEngine?.ready); await page.evaluate(() => window.__marsEngine.runScenario('classroom-4', { paused: true })); };

test('worker interrupts notes, joins and leaves class, resumes; late visitor actually joins', async ({ page }) => {
  mkdirSync(artifacts, { recursive: true }); const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message)); await boot(page);
  const picker = page.getByRole('combobox', { name: 'Classroom participant' }); await picker.selectOption('worker');
  await page.getByRole('button', { name: 'Work on Sketch notes', exact: true }).click();
  await page.evaluate(() => { for (let i = 0; i < 1000; i++) { const s = window.__marsEngine.workstation().state; if ('elapsed' in s && s.elapsed >= 2) break; window.__marsEngine.step(); } window.__marsEngine.camera([9, 3.2, -8], [6, 0.8, -5]); });
  await expect(page.getByTestId('workstation-readout')).toContainText('active');
  const working = await page.evaluate(() => window.__marsEngine.workstation()); expect('elapsed' in working.state && working.state.elapsed >= 2).toBeTruthy();
  await settle(page); await page.screenshot({ path: path.join(artifacts, 'workstation-working.png') });
  await page.getByRole('button', { name: 'Interrupt work', exact: true }).click();
  await page.evaluate(() => window.__marsEngine.step(32));
  await expect(page.getByTestId('workstation-readout')).toContainText('unfinished');
  const interrupted = await page.evaluate(() => window.__marsEngine.workstation()); expect(interrupted.claims['workstation:workstation']).toEqual([]); expect(interrupted.claims['slot:work-chair#seat']).toEqual([]);
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  await page.evaluate(() => { for (let i = 0; i < 2400 && window.__marsEngine.classroom().session?.phase !== 'presenting'; i++) window.__marsEngine.step(); });
  await page.getByRole('button', { name: 'Join session', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ask question', exact: true })).toBeDisabled();
  await expect(page.getByTestId('classroom-hud')).toContainText('worker: joining');
  await page.evaluate(() => { for (let i = 0; i < 1600 && window.__marsEngine.classroom().session?.participants.find((p) => p.actor === 'worker')?.arrival !== 'seated'; i++) window.__marsEngine.step(); });
  expect((await page.evaluate(() => window.__marsEngine.classroom())).session?.participants.find((p) => p.actor === 'worker')?.arrival).toBe('seated');
  await page.getByRole('button', { name: 'Leave session', exact: true }).click();
  await page.evaluate(() => { window.__marsEngine.step(); for (let i = 0; i < 1600 && window.__marsEngine.records().some((r) => r.verb === 'walk_to' && (r.params as { actor?: string }).actor === 'worker' && ['requested', 'executing', 'blocked'].includes(r.status)); i++) window.__marsEngine.step(); });
  expect((await page.evaluate(() => window.__marsEngine.classroom())).session?.participants.find((p) => p.actor === 'worker')?.state).toBe('excluded');
  await page.getByRole('button', { name: 'Resume Sketch notes', exact: true }).click();
  await picker.selectOption('visitor');
  await page.evaluate(() => { for (let i = 0; i < 1600 && !['presenting', 'question'].includes(window.__marsEngine.classroom().session?.phase ?? ''); i++) window.__marsEngine.step(); });
  await page.getByRole('button', { name: 'Join session', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ask question', exact: true })).toBeDisabled();
  await page.evaluate(() => { for (let i = 0; i < 2000 && window.__marsEngine.classroom().session?.participants.find((p) => p.actor === 'visitor')?.arrival !== 'seated'; i++) window.__marsEngine.step(); window.__marsEngine.camera([14, 11, 20], [0, 0.8, 1]); });
  const joined = await page.evaluate(() => window.__marsEngine.classroom()); expect(joined.session?.participants.find((p) => p.actor === 'visitor')?.arrival).toBe('seated');
  await settle(page); await page.screenshot({ path: path.join(artifacts, 'classroom-visitor-joined.png') });
  await page.evaluate(() => { for (let i = 0; i < 1600; i++) { const s = window.__marsEngine.workstation().state; if ('phase' in s && s.phase === 'working') break; window.__marsEngine.step(); } window.__marsEngine.camera([9, 3.2, -8], [6, 0.8, -5]); });
  const resumedActive = await page.evaluate(() => window.__marsEngine.workstation());
  expect('elapsed' in resumedActive.state && 'elapsed' in interrupted.state && resumedActive.state.elapsed >= interrupted.state.elapsed).toBeTruthy();
  expect('duration' in resumedActive.state && resumedActive.state.duration).toBe(30); expect('task' in resumedActive.state && resumedActive.state.task).toBe('Sketch notes'); expect('user' in resumedActive.state && resumedActive.state.user).toBe('worker');
  await settle(page); await page.screenshot({ path: path.join(artifacts, 'workstation-resumed-active.png') });
  await page.evaluate(() => { for (let i = 0; i < 2600; i++) { const s = window.__marsEngine.workstation().state; if ('status' in s && s.status === 'completed') break; window.__marsEngine.step(); } });
  const resumed = await page.evaluate(() => window.__marsEngine.workstation()); expect('progress' in resumed.state && resumed.state.progress === 1).toBeTruthy(); expect(resumed.claims['workstation:workstation']).toEqual([]); expect(resumed.claims['actor:worker']).toEqual([]);
  expect('task' in resumed.state && resumed.state.task).toBe('Sketch notes'); expect('user' in resumed.state && resumed.state.user).toBe('worker'); expect('duration' in resumed.state && resumed.state.duration).toBe(30);
  await expect(page.getByTestId('workstation-readout')).toContainText('completed');
  if (await page.getByRole('button', { name: 'End session', exact: true }).isEnabled()) { await page.getByRole('button', { name: 'End session', exact: true }).click(); await page.evaluate(() => window.__marsEngine.step(40)); }
  expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual([]); expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.records().filter((r) => r.status === 'failed'))).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.slots().filter((s) => s.claimedBy !== null))).toEqual([]);
  writeFileSync(path.join(artifacts, 'classroom-life-proof.json'), JSON.stringify({ working, interrupted, joined, resumedActive, resumed, errors, records: await page.evaluate(() => window.__marsEngine.records()) }, null, 2));
});

test('courtyard directive interrupts computer work without a classroom session', async ({ page }) => {
  mkdirSync(artifacts, { recursive: true }); await boot(page); await page.getByRole('combobox', { name: 'Classroom participant' }).selectOption('worker');
  await page.getByRole('button', { name: 'Work on Sketch notes', exact: true }).click();
  await page.evaluate(() => { for (let i = 0; i < 1000; i++) { const s = window.__marsEngine.workstation().state; if ('elapsed' in s && s.elapsed >= 1) break; window.__marsEngine.step(); } });
  await page.getByRole('button', { name: 'Direct to courtyard', exact: true }).click();
  await page.evaluate(() => { for (let i = 0; i < 1000 && window.__marsEngine.records().some((r) => ['requested', 'executing', 'blocked'].includes(r.status)); i++) window.__marsEngine.step(); });
  await expect(page.getByTestId('workstation-readout')).toContainText('unfinished');
  const state = await page.evaluate(() => ({ work: window.__marsEngine.workstation(), world: window.__marsEngine.state(), session: window.__marsEngine.classroom().session, violations: window.__marsEngine.violations() }));
  expect(await page.evaluate(() => window.__marsEngine.records().filter((r) => r.status === 'failed'))).toEqual([]);
  expect(state.session).toBeUndefined(); expect(Object.values(state.work.claims).flat()).toEqual([]); expect(state.violations).toEqual([]);
  const worker = state.world.humans.find((h) => h.id === 'worker')!; expect(Math.hypot(worker.p[0] - 12, worker.p[2] - 10)).toBeLessThan(0.06);
  await settle(page); await page.screenshot({ path: path.join(artifacts, 'workstation-directed-unfinished.png') });
  writeFileSync(path.join(artifacts, 'workstation-directive-proof.json'), JSON.stringify(state, null, 2));
});
test('workstation seated and resumed visual proof from inside the room', async ({ page }) => {
  mkdirSync(artifacts, { recursive: true }); await boot(page);
  await page.getByRole('combobox', { name: 'Classroom participant' }).selectOption('worker');
  await page.getByRole('button', { name: 'Work on Sketch notes', exact: true }).click();
  await page.evaluate(() => { for (let i = 0; i < 1200; i++) { const s = window.__marsEngine.workstation().state; if ('elapsed' in s && s.elapsed >= 3) break; window.__marsEngine.step(); } window.__marsEngine.camera([9, 3.2, -8], [6, 0.65, -5.5]); });
  const before = await page.evaluate(() => window.__marsEngine.workstation());
  expect('phase' in before.state && before.state.phase).toBe('working');
  await settle(page); await page.screenshot({ path: path.join(artifacts, 'workstation-seated-clear.png') });
  await page.getByRole('button', { name: 'Interrupt work', exact: true }).click(); await page.evaluate(() => window.__marsEngine.step(32));
  await page.getByRole('button', { name: 'Resume Sketch notes', exact: true }).click();
  await page.evaluate(() => { for (let i = 0; i < 1000; i++) { const s = window.__marsEngine.workstation().state; if ('phase' in s && s.phase === 'working') break; window.__marsEngine.step(); } window.__marsEngine.step(10); });
  const resumed = await page.evaluate(() => window.__marsEngine.workstation());
  expect('elapsed' in resumed.state && 'elapsed' in before.state && resumed.state.elapsed > before.state.elapsed).toBeTruthy();
  await settle(page); await page.screenshot({ path: path.join(artifacts, 'workstation-resumed-clear.png') });
  await page.getByRole('button', { name: 'Interrupt work', exact: true }).click(); await page.evaluate(() => window.__marsEngine.step(32));
  expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual([]); expect(await page.evaluate(() => window.__marsEngine.records().filter((r) => r.status === 'failed'))).toEqual([]);
  expect((await page.evaluate(() => window.__marsEngine.workstation())).claims['workstation:workstation']).toEqual([]);
  writeFileSync(path.join(artifacts, 'workstation-visual-proof.json'), JSON.stringify({ before, resumed }, null, 2));
});
