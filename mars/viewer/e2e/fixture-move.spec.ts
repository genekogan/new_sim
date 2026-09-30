/// <reference types="node" />
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
declare global { interface Window { __marsEngine: EngineHook } }
const artifacts = path.resolve('e2e/artifacts', process.env.E2E_RUN ?? 'fixture-move');
const settle = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
const until = (page: Page, phase: string) => page.evaluate((wanted) => {
  for (let i = 0; i < 6000; i++) {
    const r = window.__marsEngine.fixtureMove();
    if (r?.phase === wanted) return r;
    if (r && ['completed', 'failed', 'cancelled'].includes(r.status)) throw Error(JSON.stringify(r));
    window.__marsEngine.step();
  }
  throw Error(`chair never reached ${wanted}`);
}, phase);
const finish = (page: Page) => page.evaluate(() => {
  for (let i = 0; i < 6000; i++) {
    const r = window.__marsEngine.fixtureMove();
    if (r && ['completed', 'failed', 'cancelled'].includes(r.status)) return r;
    window.__marsEngine.step();
  }
  throw Error('chair did not finish');
});
for (const count of [4, 8]) test(`physical chair setup, safe interruption and actual seating in classroom ${count}`, async ({ page }) => {
  mkdirSync(artifacts, { recursive: true });
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/lab?scenario=classroom-${count}`);
  await page.waitForFunction(() => window.__marsEngine?.ready);
  await page.evaluate((n) => window.__marsEngine.runScenario(`classroom-${n}`, { paused: true }), count);
  const chair = count === 8 ? 'seat12' : 'seat8';
  await page.getByRole('combobox', { name: 'Classroom participant' }).selectOption('worker');
  await page.getByRole('button', { name: 'Move spare chair to side', exact: true }).click();
  await until(page, 'move');
  await page.evaluate(() => window.__marsEngine.step(20));
  const held = await page.evaluate((id) => ({ state: window.__marsEngine.fixtureMove(), fixture: window.__marsEngine.fixtures().find((e) => e.id === id), actor: window.__marsEngine.state().humans.find((e) => e.id === 'worker'), bones: window.__marsEngine.bones('worker') }), chair);
  expect(held.fixture).toMatchObject({ def: 'camp-chair', support: 'held', phase: 'carried' });
  expect(held.fixture!.pose.pitch ?? 0).toBe(0); expect(held.fixture!.pose.roll ?? 0).toBe(0);
  await page.evaluate((id) => { const e = window.__marsEngine.fixtures().find((e) => e.id === id)!; window.__marsEngine.camera([e.pose.p[0]+3, 2.7, e.pose.p[2]+3], [e.pose.p[0], 1, e.pose.p[2]]); }, chair);
  await settle(page); await page.screenshot({ path: path.join(artifacts, `chair-${count}-held.png`) });
  await page.getByRole('button', { name: 'Stop moving chair', exact: true }).click();
  expect((await finish(page))!.status).toBe('cancelled');
  expect(await page.evaluate((id) => window.__marsEngine.fixtures().find((e) => e.id === id)!.support, chair)).toBe('ground');
  await settle(page); await page.screenshot({ path: path.join(artifacts, `chair-${count}-cancelled-ground.png`) });
  await page.getByRole('button', { name: 'Move spare chair to side', exact: true }).click();
  await until(page, 'set-down');
  await page.evaluate(() => window.__marsEngine.step(10));
  await page.evaluate((id) => { const e = window.__marsEngine.fixtures().find((e) => e.id === id)!; window.__marsEngine.camera([e.pose.p[0]+3, 2.7, e.pose.p[2]+3], [e.pose.p[0], 0.8, e.pose.p[2]]); }, chair);
  await settle(page); await page.screenshot({ path: path.join(artifacts, `chair-${count}-lowering.png`) });
  expect((await finish(page))!.status).toBe('completed');
  const placed = await page.evaluate((id) => window.__marsEngine.fixtures().find((e) => e.id === id), chair);
  expect(placed!.pose.p).toEqual([7.5, 0, count === 8 ? 4.5 : 3]);
  expect(placed!.support).toBe('ground');
  // Explicit physical cleanup: a carrier remains where the load was put down.
  // Clearing future gathering positions is a supported instruction, never a hidden pose edit.
  await page.getByRole('button', { name: 'Direct to courtyard', exact: true }).click();
  const cleared = await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) {
      const r = window.__marsEngine.records().filter((r) => r.verb === 'walk_to' && (r.params as { actor?: string }).actor === 'worker').at(-1);
      if (r && ['completed', 'failed', 'cancelled'].includes(r.status)) return r;
      window.__marsEngine.step();
    }
    throw Error('carrier did not clear setup');
  });
  expect(cleared.status).toBe('completed');
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) { if (window.__marsEngine.classroom().session?.phase === 'presenting') return; window.__marsEngine.step(); }
    throw Error('class never presented');
  });
  await page.getByRole('combobox', { name: 'Classroom participant' }).selectOption('visitor');
  await page.getByRole('button', { name: 'Join session', exact: true }).click();
  const visitor = await page.evaluate(() => {
    for (let i = 0; i < 6000; i++) {
      const v = window.__marsEngine.classroom().session?.participants.find((p) => p.actor === 'visitor');
      if (v?.arrival === 'seated') return { participant: v, human: window.__marsEngine.state().humans.find((e) => e.id === 'visitor') };
      window.__marsEngine.step();
    }
    throw Error('visitor never used moved chair');
  });
  expect(visitor.participant.seat).toBe(`${chair}#seat`);
  expect(visitor.human!.p[0]).toBe(7.5); expect(visitor.human!.p[2]).toBe(count === 8 ? 4.5 : 3);
  await page.evaluate(() => window.__marsEngine.camera([12, 3.5, 9], [7, 1, 3]));
  await settle(page); await page.screenshot({ path: path.join(artifacts, `chair-${count}-visitor-seated.png`) });
  await page.getByRole('combobox', { name: 'Classroom participant' }).selectOption('worker');
  const before = await page.evaluate(() => window.__marsEngine.stateHash());
  await page.getByRole('button', { name: 'Return chair to row', exact: true }).click();
  await expect(page.getByTestId('fixture-move-feedback')).toContainText('move_fixture.occupied');
  expect(await page.evaluate(() => window.__marsEngine.stateHash())).toBe(before);
  await page.getByRole('combobox', { name: 'Classroom participant' }).selectOption('visitor');
  await page.getByRole('button', { name: 'Ask question', exact: true }).click();
  await page.evaluate(() => {
    for (let i = 0; i < 3000; i++) {
      const s = window.__marsEngine.classroom().session;
      if (s?.phase === 'question' && s.floorHolder === 'visitor') return;
      window.__marsEngine.step();
    }
    throw Error('moved-chair visitor never held the question floor');
  });
  await settle(page); await page.screenshot({ path: path.join(artifacts, `chair-${count}-question.png`) });
  const conversations = await page.evaluate(() => {
    for (let i = 0; i < 12000; i++) {
      const s = window.__marsEngine.classroom().session;
      if (s?.phase === 'conversing' && s.groups.every((g) => g.status === 'talking')) return s;
      const r = window.__marsEngine.records().filter((r) => r.verb === 'classroom_session').at(-1);
      if (r && ['completed', 'failed', 'cancelled'].includes(r.status)) throw Error(JSON.stringify(r));
      window.__marsEngine.step();
    }
    throw Error('rearranged classroom never formed conversations');
  });
  await page.evaluate(() => window.__marsEngine.cameraPreset('oblique'));
  await settle(page); await page.screenshot({ path: path.join(artifacts, `chair-${count}-conversations.png`) });
  const ended = await page.evaluate(() => {
    for (let i = 0; i < 12000; i++) {
      const r = window.__marsEngine.records().filter((r) => r.verb === 'classroom_session').at(-1);
      if (r && ['completed', 'failed', 'cancelled'].includes(r.status)) return r;
      window.__marsEngine.step();
    }
    throw Error('rearranged classroom never cleaned up');
  });
  expect(ended.status).toBe('completed');
  expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual([]);
  expect((await page.evaluate(() => window.__marsEngine.records())).filter((r) => r.status === 'failed').map((r) => r.diagnostic?.code)).toEqual(['move_fixture.occupied']);
  expect(errors).toEqual([]);
  writeFileSync(path.join(artifacts, `chair-${count}-proof.json`), JSON.stringify({ held, placed, visitor, conversations, ended, errors }, null, 2));
});
