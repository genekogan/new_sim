/// <reference types="node" />
import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
import type { readCommunalSupper } from '../engine/activities/communal-supper.ts';
declare global {
  interface Window {
    __marsEngine: EngineHook;
  }
}
type SupperHook = EngineHook & {
  communalSupper: () => ReturnType<typeof readCommunalSupper> | null;
};
const source = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
  directory = path.resolve(
    'e2e/artifacts',
    process.env.E2E_RUN ?? `communal-supper-${source.slice(0, 7)}`,
  );
const button = (p: Page, name: string) =>
  p.getByRole('button', { name, exact: true });
async function inspect(page: Page) {
  return page.evaluate(() => {
    const h = window.__marsEngine as SupperHook;
    return {
      supper: h.communalSupper(),
      state: h.state(),
      records: h.records(),
      held: h.heldItems(),
      slots: h.slots(),
      hands: h.humanFields(),
      bones: h.bones(),
      entities: h.cameraEntities(),
      violations: h.violations(),
    };
  });
}
type Snapshot = Awaited<ReturnType<typeof inspect>>;
function read(s: Snapshot) {
  if (!s.supper) throw Error('Missing authoritative communal supper readout');
  return s.supper;
}
function item(s: Snapshot, id: string) {
  const e = read(s).items.find((e) => e?.id === id);
  if (!e) throw Error(`Missing actual ${id}`);
  return e;
}
async function play(p: Page) {
  if (await p.evaluate(() => window.__marsEngine.state().paused))
    await button(p, 'Play').click();
}
async function freeze(p: Page) {
  if (!(await p.evaluate(() => window.__marsEngine.state().paused)))
    await button(p, 'Pause').click();
}
async function frame(
  p: Page,
  focus: 'table' | 'meal-table' | 'ware-store' | 'prep-store' | 'conversation',
) {
  await p.evaluate((focus) => {
    const h = window.__marsEngine;
    const e = h.cameraEntities().find((e) => e.id === focus),
      t: [number, number, number] =
        focus === 'conversation'
          ? [2.5, 1, 3]
          : e
            ? [e.pose.p[0], e.pose.p[1] + 0.8, e.pose.p[2]]
            : [0, 0.8, 0];
    h.camera([t[0] + 3.5, t[1] + 3, t[2] - 4], t);
  }, focus);
}
async function capture(
  p: Page,
  name: string,
  focus: Parameters<typeof frame>[1],
) {
  await freeze(p);
  await frame(p, focus);
  const data = await inspect(p);
  mkdirSync(directory, { recursive: true });
  await p.screenshot({ path: path.join(directory, `${name}.png`) });
  writeFileSync(
    path.join(directory, `${name}.a11y.yml`),
    await p.locator('body').ariaSnapshot(),
  );
  writeFileSync(
    path.join(directory, `${name}.json`),
    JSON.stringify({ source, run: process.env.E2E_RUN, data }, null, 2),
  );
  return data;
}
function conserved(s: Snapshot) {
  const a = read(s),
    consumed = a.meal?.receipts?.reduce((n, r) => n + r.consumed, 0) ?? 0;
  const material = ['beans', 'greens', 'pot', 'cook-bowl', 'guest-bowl'].map(
    (id) => item(s, id),
  );
  for (const e of material) {
    expect(Number.isFinite(e.contents?.fraction)).toBe(true);
    expect(e.contents!.fraction).toBeGreaterThanOrEqual(0);
    expect(e.contents!.fraction).toBeLessThanOrEqual(1);
  }
  expect(
    Math.round(
      (item(s, 'beans').contents!.fraction +
        item(s, 'greens').contents!.fraction +
        4 * item(s, 'pot').contents!.fraction +
        item(s, 'cook-bowl').contents!.fraction +
        item(s, 'guest-bowl').contents!.fraction +
        consumed) *
        1e6,
    ) / 1e6,
  ).toBe(2);
  expect(item(s, 'beans').contents?.food).toBe('beans');
  expect(item(s, 'greens').contents?.food).toBe('greens');
  expect(item(s, 'pot').contents?.food).toBe('hypothetical cold shared dish');
  expect(s.violations).toEqual([]);
  expect(a.items.map((e) => e?.id).sort()).toEqual([
    'beans',
    'cook-bowl',
    'greens',
    'guest-bowl',
    'guest-spoon',
    'pot',
    'spoon',
  ]);
}
function released(s: Snapshot) {
  expect({
    held: s.held,
    claimed: s.slots.filter((s) => s.claimedBy !== null),
    active: s.records.filter(
      (r) => !['completed', 'cancelled'].includes(r.status),
    ),
    claims: read(s).claims.filter((c) => c.holders.length),
    violations: s.violations,
  }).toEqual({ held: [], claimed: [], active: [], claims: [], violations: [] });
}
type Phase =
  | 'partial-preparation'
  | 'paused'
  | 'prepared'
  | 'served'
  | 'partial-eating'
  | 'consumed'
  | 'meal-return'
  | 'meal-transfer'
  | 'meal-stored'
  | 'prep-transfer'
  | 'finished'
  | 'ended';
async function wait(p: Page, phase: Phase) {
  await p.waitForFunction(
    (phase) => {
      const a = (window.__marsEngine as SupperHook).communalSupper();
      if (!a) return false;
      const fractions = a.meal?.receipts ?? [],
        ps = a.preparation;
      if (phase === 'partial-preparation')
        return (
          a.stage === 'preparing' &&
          !!ps &&
          ps.ingredients.some(
            (i) => i.deposited > 0 && i.deposited < i.initial,
          ) &&
          !ps.complete
        );
      if (phase === 'paused') return a.mode === 'paused';
      if (phase === 'prepared') return !!ps?.complete && a.prepared;
      if (phase === 'served')
        return (
          fractions.length === 2 &&
          fractions.every((r) => r.served && r.remaining === 1)
        );
      if (phase === 'partial-eating')
        return (
          fractions.length === 2 &&
          fractions.every((r) => r.remaining > 0 && r.remaining < 1) &&
          a.meal?.phase === 'eating'
        );
      if (phase === 'consumed')
        return (
          fractions.length === 2 &&
          fractions.every((r) => r.consumptionCompleted && r.remaining === 0) &&
          ['eating', 'releasing'].includes(a.meal?.phase ?? '') &&
          a.held.every((h) => h.items.length === 2)
        );
      if (phase === 'meal-return')
        return (
          a.mealComplete &&
          a.items
            .filter((e) =>
              ['cook-bowl', 'guest-bowl', 'spoon', 'guest-spoon'].includes(
                e?.id ?? '',
              ),
            )
            .every(
              (e) =>
                e?.support?.kind === 'resting-on' &&
                e.support.on === 'meal-table',
            )
        );
      if (phase === 'meal-transfer')
        return (
          a.stage === 'storing-mealware' &&
          a.cleanup.some((c) => c?.current?.held)
        );
      if (phase === 'meal-stored')
        return a.cleanup.some(
          (c) => c?.finished && c.bindings.transfers.length === 4,
        );
      if (phase === 'prep-transfer')
        return (
          a.stage === 'storing-prepware' &&
          a.cleanup.some((c) => c?.current?.held)
        );
      if (phase === 'finished') return a.finished && a.mode === 'completed';
      return a.mode === 'completed' && !a.finished;
    },
    phase,
    { timeout: 15_000 },
  );
}
async function setup(p: Page) {
  await p.goto('/lab?scenario=communal-supper');
  await p.waitForFunction(
    () =>
      window.__marsEngine?.ready &&
      typeof (window.__marsEngine as SupperHook).communalSupper === 'function',
    undefined,
    { timeout: 15_000 },
  );
  await p.evaluate(() =>
    window.__marsEngine.runScenario('communal-supper', {
      paused: true,
      speed: 4,
    }),
  );
  await button(p, 'Reset').click();
  await button(p, 'Step').click(); // fresh readiness only; journeys use actual Play.
  expect((await inspect(p)).records).toEqual([]);
  await expect(p.getByTestId('communal-supper-hud')).toContainText(
    'Hypothetical anonymous cook and guest',
  );
}
function errors(p: Page) {
  const out: string[] = [];
  p.on('pageerror', (e) => out.push(e.message));
  p.on('console', (e) => {
    if (e.type() === 'error') out.push(e.text());
  });
  return out;
}
test.afterEach(async ({ page }, info) => {
  mkdirSync(directory, { recursive: true });
  const name = info.title.startsWith('retained') ? 'retained' : 'end-reset';
  if (info.status !== info.expectedStatus) {
    try {
      await capture(page, `${name}-failure`, 'conversation');
    } catch (e) {
      writeFileSync(
        path.join(directory, `${name}-capture-error.txt`),
        String(e),
      );
    }
  }
  writeFileSync(
    path.join(directory, `${name}-result.json`),
    JSON.stringify(
      {
        source,
        status: info.status,
        errors: info.errors.map((e) => e.message),
      },
      null,
      2,
    ),
  );
});
test('retained preparation and consumed meal continue to actual seven-vessel storage under Play', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const consoleErrors = errors(page);
  await setup(page);
  await button(page, 'Start supper').click();
  await play(page);
  await wait(page, 'partial-preparation');
  const partial = await capture(
      page,
      'retained-partial-actual-ingredient-deposit',
      'table',
    ),
    first = read(partial),
    identities = first.items.map((e) => ({
      id: e!.id,
      def: e!.def,
      provenance: e!.provenance,
    }));
  conserved(partial);
  expect(
    first.preparation!.ingredients.some(
      (i) => i.deposited > 0 && i.deposited < i.initial,
    ),
  ).toBe(true);
  expect(item(partial, 'spoon').support).toEqual({
    kind: 'in-hand',
    by: 'cook',
    hand: 'right',
  });
  expect(partial.held.find((e) => e.id === 'spoon')).toMatchObject({
    by: 'cook',
    hand: 'right',
  });
  await button(page, 'Pause supper').click();
  await play(page);
  await wait(page, 'paused');
  const paused = await capture(
    page,
    'retained-safe-preparation-pause',
    'table',
  );
  conserved(paused);
  expect(read(paused).preparation).toEqual(first.preparation);
  await button(page, 'Direct cook away').click();
  await play(page);
  await page.waitForFunction(
    () =>
      window.__marsEngine
        .records()
        .some(
          (r) =>
            r.verb === 'walk_to' &&
            !r.parent &&
            (r.params as { actor?: string }).actor === 'cook' &&
            r.status === 'completed',
        ),
    undefined,
    { timeout: 15_000 },
  );
  const directed = await capture(
    page,
    'retained-ordinary-cook-direction',
    'table',
  );
  conserved(directed);
  expect(read(directed).preparation).toEqual(read(paused).preparation);
  expect(read(directed).mode).toBe('paused');
  await expect(button(page, 'Resume supper')).toBeEnabled();
  await button(page, 'Resume supper').click();
  await play(page);
  await wait(page, 'prepared');
  const prepared = await capture(
    page,
    'retained-same-pot-prepared-cold-material',
    'table',
  );
  conserved(prepared);
  expect({
    pot: item(prepared, 'pot').id,
    fraction: item(prepared, 'pot').contents!.fraction,
    ingredients: read(prepared).preparation!.ingredients.map(
      (i) => i.deposited,
    ),
    complete: read(prepared).preparation!.complete,
  }).toEqual({
    pot: 'pot',
    fraction: 0.5,
    ingredients: [1, 1],
    complete: true,
  });
  await play(page);
  await wait(page, 'served');
  const served = await capture(
    page,
    'retained-both-actual-servings',
    'conversation',
  );
  conserved(served);
  expect(
    read(served).meal!.receipts!.map((r) => ({
      actor: r.actor,
      bowl: r.bowl,
      spoon: r.spoon,
      served: r.served,
      remaining: r.remaining,
    })),
  ).toEqual([
    {
      actor: 'cook',
      bowl: 'cook-bowl',
      spoon: 'spoon',
      served: true,
      remaining: 1,
    },
    {
      actor: 'guest',
      bowl: 'guest-bowl',
      spoon: 'guest-spoon',
      served: true,
      remaining: 1,
    },
  ]);
  await play(page);
  await wait(page, 'partial-eating');
  const eating = await capture(
    page,
    'retained-actual-turns-partial-consumption',
    'conversation',
  );
  conserved(eating);
  expect(read(eating).meal!.floorHolder).toMatch(/^(cook|guest)$/);
  expect(read(eating).held.map((h) => h.items.length)).toEqual([2, 2]);
  await button(page, 'Pause supper').click();
  await play(page);
  await wait(page, 'paused');
  const mealPaused = await capture(
      page,
      'retained-partial-meal-safe-pause',
      'conversation',
    ),
    originalMeal = read(mealPaused).meal!;
  conserved(mealPaused);
  expect(originalMeal.status).toBe('cancelled');
  expect(
    originalMeal.receipts!.every((r) => r.consumed > 0 && r.remaining > 0),
  ).toBe(true);
  await button(page, 'Resume supper').click();
  await play(page);
  await wait(page, 'consumed');
  const consumed = await capture(
      page,
      'retained-both-consumed-before-ordinary-stow',
      'conversation',
    ),
    consumedMeal = read(consumed).meal!;
  conserved(consumed);
  expect(consumedMeal.resumeFrom).toBe(originalMeal.action);
  expect(consumedMeal.purpose).toBe(originalMeal.purpose);
  expect(
    consumedMeal.receipts!.map((r) => ({
      portion: r.portion,
      consumed: r.consumed,
      remaining: r.remaining,
      complete: r.consumptionCompleted,
    })),
  ).toEqual([
    { portion: 1, consumed: 1, remaining: 0, complete: true },
    { portion: 1, consumed: 1, remaining: 0, complete: true },
  ]);
  await button(page, 'Pause supper').click();
  await play(page);
  await wait(page, 'paused');
  const emptyPaused = await capture(
      page,
      'retained-empty-bowls-real-held-checkpoint',
      'conversation',
    ),
    checkpoint = read(emptyPaused).meal!;
  conserved(emptyPaused);
  expect(checkpoint.status).toBe('cancelled');
  expect(checkpoint.receipts).toEqual(consumedMeal.receipts);
  const serveCount = emptyPaused.records.filter(
    (r) => r.verb === 'serve',
  ).length;
  await button(page, 'Resume supper').click();
  await play(page);
  await wait(page, 'meal-return');
  const returned = await capture(
    page,
    'retained-same-mealware-supported-return',
    'meal-table',
  );
  conserved(returned);
  expect(returned.records.filter((r) => r.verb === 'serve').length).toBe(
    serveCount,
  );
  expect(read(returned).meal!.purpose).toBe(originalMeal.purpose);
  for (const role of read(returned).bindings.meal.participants)
    for (const t of role.returns)
      expect(item(returned, t.item).support).toEqual({
        kind: 'resting-on',
        on: t.surfaceSlot.split('#')[0],
        slot: t.surfaceSlot.split('#')[1],
      });
  await play(page);
  await wait(page, 'meal-transfer');
  const transferring = await capture(
    page,
    'retained-real-mealware-cleanup-hand',
    'ware-store',
  );
  conserved(transferring);
  expect(read(transferring).cleanup.some((c) => c?.current?.held)).toBe(true);
  await play(page);
  await wait(page, 'meal-stored');
  const mealStored = await capture(
    page,
    'retained-four-same-meal-vessels-stored',
    'ware-store',
  );
  conserved(mealStored);
  for (const t of read(mealStored).bindings.cleanup[0].transfers)
    expect(item(mealStored, t.item).support).toEqual({
      kind: 'resting-on',
      on: 'ware-store',
      slot: t.to.split('#')[1],
    });
  await play(page);
  await wait(page, 'prep-transfer');
  const prepTransfer = await capture(
    page,
    'retained-real-preparation-ware-cleanup-hand',
    'prep-store',
  );
  conserved(prepTransfer);
  await play(page);
  await wait(page, 'finished');
  const final = await capture(
    page,
    'retained-seven-original-vessels-complete',
    'prep-store',
  );
  conserved(final);
  released(final);
  expect(
    read(final).items.map((e) => ({
      id: e!.id,
      def: e!.def,
      provenance: e!.provenance,
    })),
  ).toEqual(identities);
  for (const batch of read(final).bindings.cleanup)
    for (const t of batch.transfers)
      expect(item(final, t.item).support).toEqual({
        kind: 'resting-on',
        on: t.to.split('#')[0],
        slot: t.to.split('#')[1],
      });
  expect(final.records.filter((r) => r.verb === 'serve').length).toBe(2);
  expect(consoleErrors).toEqual([]);
});
test('end before first step and held meal draining preserve material without orphan actions, then Reset releases everything', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const consoleErrors = errors(page);
  await setup(page);
  await button(page, 'Start supper').click();
  await button(page, 'End supper').click();
  await expect(button(page, 'Pause supper')).toBeDisabled();
  await expect(button(page, 'Resume supper')).toBeDisabled();
  await play(page);
  await wait(page, 'ended');
  const beforeStep = await capture(
    page,
    'end-reset-before-first-step-no-phantom-meal',
    'table',
  );
  conserved(beforeStep);
  released(beforeStep);
  expect(read(beforeStep).preparation).toBeUndefined();
  expect(read(beforeStep).meal).toBeUndefined();
  expect(
    beforeStep.records.filter((r) =>
      [
        'prepare_food',
        'shared_food_break',
        'tidy_table',
        'stow_items',
        'serve',
        'eat',
      ].includes(r.verb),
    ),
  ).toEqual([]);
  expect(item(beforeStep, 'pot').contents!.fraction).toBe(0);
  expect(item(beforeStep, 'beans').contents!.fraction).toBe(1);
  expect(item(beforeStep, 'greens').contents!.fraction).toBe(1);
  await button(page, 'Reset').click();
  await button(page, 'Step').click();
  expect((await inspect(page)).records).toEqual([]);
  expect((await inspect(page)).supper).toBeNull();
  await button(page, 'Start supper').click();
  await play(page);
  await wait(page, 'partial-preparation');
  await play(page);
  await wait(page, 'prepared');
  await play(page);
  await wait(page, 'served');
  const held = await capture(
    page,
    'end-reset-actual-held-meal-vessels',
    'conversation',
  );
  conserved(held);
  expect(read(held).held.map((h) => h.items.length)).toEqual([2, 2]);
  const materials = read(held).items.map((e) => ({
    id: e!.id,
    def: e!.def,
    contents: e!.contents,
    provenance: e!.provenance,
  }));
  await button(page, 'End supper').click();
  await expect(button(page, 'Resume supper')).toBeDisabled();
  await expect(button(page, 'Start supper')).toBeDisabled();
  await play(page);
  await wait(page, 'ended');
  const ended = await capture(
    page,
    'end-reset-real-safe-utensil-return',
    'meal-table',
  );
  conserved(ended);
  released(ended);
  expect(
    read(ended).items.map((e) => ({
      id: e!.id,
      def: e!.def,
      contents: e!.contents,
      provenance: e!.provenance,
    })),
  ).toEqual(materials);
  expect(read(ended).finished).toBe(false);
  for (const role of read(ended).bindings.meal.participants)
    for (const t of role.returns)
      expect(item(ended, t.item).support).toEqual({
        kind: 'resting-on',
        on: 'meal-table',
        slot: t.surfaceSlot.split('#')[1],
      });
  expect(ended.records.filter((r) => r.verb === 'tidy_table')).toEqual([]);
  await button(page, 'Reset').click();
  await button(page, 'Step').click();
  const reset = await capture(
    page,
    'end-reset-fresh-hypothetical-world',
    'table',
  );
  expect({
    supper: reset.supper,
    records: reset.records,
    held: reset.held,
    claims: reset.slots.filter((s) => s.claimedBy !== null),
    violations: reset.violations,
  }).toEqual({
    supper: null,
    records: [],
    held: [],
    claims: [],
    violations: [],
  });
  expect(reset.entities.map((e) => e.id).sort()).toEqual(
    held.entities.map((e) => e.id).sort(),
  );
  expect(consoleErrors).toEqual([]);
});
