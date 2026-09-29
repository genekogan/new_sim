import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openLab, labFrames } from './lab-helpers';
import { ARTIFACTS, collectConsoleErrors } from './helpers';

test('raise cancellation lowers the held frame continuously to ground (LM-036)', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  await openLab(page, 'raise-cancel-proof');
  await expect(page.getByRole('combobox', { name: 'Scenario', exact: true })).toHaveValue('raise-cancel-proof');
  await expect(page.getByRole('option', { name: 'Hypothetical raise cancellation proof' })).toBeAttached();
  await page.evaluate(() => window.__marsEngine!.runScenario('raise-cancel-proof', { paused: true }));
  const started = await page.evaluate(() => {
    const h = window.__marsEngine!;
    for (let i = 0; i < 10000; i++) {
      const frame = h.components().find((c) => c.id === 'A');
      if (frame?.phase === 'raising' && (frame.pose.pitch ?? 0) < 0.75) {
        const actor = h.state().humans.find((p) => p.activity === 'support' && p.task);
        if (!actor?.task) throw new Error('raise has no holder action');
        return { frame, record: h.cancelAction(actor.task) };
      }
      h.step(1);
    }
    throw new Error('raise never reached the requested physical pitch');
  });
  expect(started.record.diagnostic).toBeUndefined();
  expect(started.record.status).toBe('executing');
  await page.evaluate(() => window.__marsEngine!.step(20));
  const mid = await page.evaluate(() => ({ frame: window.__marsEngine!.components().find((c) => c.id === 'A')!, state: window.__marsEngine!.state(), violations: window.__marsEngine!.violations() }));
  expect(mid.frame.pose.pitch!).toBeGreaterThan(started.frame.pose.pitch!);
  expect(mid.frame.pose.pitch!).toBeLessThan(Math.PI / 2);
  expect(mid.frame.support).toBe('held');
  expect(mid.violations).toEqual([]);
  expect(mid.state.humans.filter((h) => h.task === started.record.id && h.activity === 'support').length).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => window.__marsEngine!.camera([6, 3.4, -5.5], [0, 1, -1.4]));
  await labFrames(page, 4);
  mkdirSync(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS, 'raise-cancel-lowering.png'), animations: 'disabled' });
  const final = await page.evaluate((id) => {
    const h = window.__marsEngine!;
    for (let i = 0; i < 2000 && h.records().find((r) => r.id === id)?.status !== 'cancelled'; i++) h.step(1);
    return { frame: h.components().find((c) => c.id === 'A')!, record: h.records().find((r) => r.id === id)!, state: h.state(), violations: h.violations() };
  }, started.record.id);
  expect(final.record.status).toBe('cancelled');
  expect(final.frame.support).toBe('ground');
  expect(final.frame.pose.pitch).toBe(Math.PI / 2);
  expect(Math.min(...final.frame.corners.map((p) => p[1]))).toBeCloseTo(0, 6);
  expect(final.violations).toEqual([]);
  expect(final.state.humans.some((h) => h.task === started.record.id)).toBe(false);
  await labFrames(page, 4);
  await page.screenshot({ path: path.join(ARTIFACTS, 'raise-cancel-lying.png'), animations: 'disabled' });
  writeFileSync(path.join(ARTIFACTS, 'raise-cancel.json'), JSON.stringify({ started, mid, final }, null, 2));
  expect(errors).toEqual([]);
});

test('cluttered build bay refuses an unsafe reverse holder path (LM-036)', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await openLab(page, 'build-bay');
  await page.evaluate(() => window.__marsEngine!.runScenario('build-bay', { paused: true }));
  const proof = await page.evaluate(() => {
    const h = window.__marsEngine!;
    for (let i = 0; i < 10000; i++) {
      const frame = h.components().find((c) => c.id === 'A');
      if (frame?.phase === 'raising' && (frame.pose.pitch ?? 0) < 0.75) {
        const actor = h.state().humans.find((p) => p.activity === 'support' && p.task);
        if (!actor?.task) throw new Error('raise has no holder action');
        const before = { components: h.components(), state: h.state() };
        const record = h.cancelAction(actor.task);
        return { before, after: { components: h.components(), state: h.state() }, record, violations: h.violations() };
      }
      h.step(1);
    }
    throw new Error('build bay never reached mid-raise');
  });
  expect(proof.record.diagnostic?.code).toBe('raise.cancel-unsafe');
  expect(proof.after).toEqual(proof.before);
  expect(proof.violations).toEqual([]);
  await page.evaluate(() => window.__marsEngine!.camera([6, 3.4, -5.5], [0, 1, -1.4]));
  await labFrames(page, 4);
  mkdirSync(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS, 'raise-cancel-refused.png'), animations: 'disabled' });
  writeFileSync(path.join(ARTIFACTS, 'raise-cancel-refused.json'), JSON.stringify(proof, null, 2));
  expect(errors).toEqual([]);
});
