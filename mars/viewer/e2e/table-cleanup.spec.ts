/// <reference types="node" />
import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
declare global {
  interface Window {
    __marsEngine: EngineHook;
  }
}
const source = {
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  trackedChanges: execFileSync('git', ['diff', '--name-only', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
};
const artifacts = path.resolve(
  'e2e/artifacts',
  process.env.E2E_RUN ?? 'table-cleanup',
);
const errors = new WeakMap<Page, string[]>();
const button = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true });
async function inspect(page: Page) {
  return page.evaluate(() => ({
    state: window.__marsEngine.state(),
    epoch: window.__marsEngine.scenarioEpoch,
    cleanup: window.__marsEngine.tableCleanup(),
    components: window.__marsEngine.components(),
    fixtures: window.__marsEngine.fixtures(),
    held: window.__marsEngine.heldItems(),
    hands: window.__marsEngine.humanFields(),
    bones: window.__marsEngine.bones(),
    records: window.__marsEngine.records(),
    claims: window.__marsEngine.garden().claims,
    slots: window.__marsEngine.slots(),
    violations: window.__marsEngine.violations(),
  }));
}
type Evidence = Awaited<ReturnType<typeof inspect>>;
function save(name: string, evidence: unknown) {
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(
    path.join(artifacts, `${name}.json`),
    JSON.stringify({ source, run: process.env.E2E_RUN, evidence }, null, 2),
  );
}
async function freeze(page: Page) {
  if (!(await page.evaluate(() => window.__marsEngine.state().paused)))
    await button(page, 'Pause').click();
}
async function play(page: Page) {
  if (await page.evaluate(() => window.__marsEngine.state().paused))
    await button(page, 'Play').click();
}
async function capture(page: Page, name: string) {
  await freeze(page);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const s = await inspect(page);
  expect(s.violations).toEqual([]);
  await page.screenshot({ path: path.join(artifacts, `${name}.png`) });
  writeFileSync(
    path.join(artifacts, `${name}.a11y.yml`),
    await page.locator('body').ariaSnapshot(),
  );
  save(name, s);
  return s;
}
async function open(page: Page, scenario: string, rotated: boolean) {
  mkdirSync(artifacts, { recursive: true });
  const log: string[] = [];
  errors.set(page, log);
  page.on('pageerror', (e) => log.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error') log.push(e.text());
  });
  await page.goto(`/lab?scenario=${scenario}`);
  await page.waitForFunction(() => window.__marsEngine?.ready);
  await page.evaluate(
    (name) => window.__marsEngine.runScenario(name, { paused: true, speed: 2 }),
    scenario,
  );
  const select = page.getByRole('combobox', { name: 'Scenario', exact: true });
  await expect(select.locator(`option[value="${scenario}"]`)).toHaveCount(1);
  await select.selectOption(scenario);
  await button(page, 'Reset').click();
  await button(page, 'Step').click(); // Fresh first-tick readiness only. All activity execution uses Play.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const initial = await inspect(page);
  expect(initial.state.scenario).toBe(scenario);
  expect(initial.state.tick).toBe(1);
  expect(initial.records).toEqual([]);
  expect(initial.cleanup).toBeNull();
  clean(initial);
  await expect(page.getByTestId('table-cleanup-hud')).toBeVisible();
  await expect(page.getByTestId('table-cleanup-items')).toContainText(
    'meal-bowl',
  );
  await expect(page.getByTestId('table-cleanup-items')).toContainText(
    '0.2500 bowl',
  );
  await page.evaluate(
    (rotated) =>
      window.__marsEngine.camera(rotated ? [6, 4, 5] : [5, 4, -6], [0, 0.8, 0]),
    rotated,
  );
  return initial;
}
function cleanup(s: Evidence) {
  expect(s.cleanup).not.toBeNull();
  return s.cleanup!;
}
function identities(s: Evidence, initial: Evidence) {
  expect(s.components.map((c) => [c.id, c.def])).toEqual(
    initial.components.map((c) => [c.id, c.def]),
  );
  expect(s.fixtures).toEqual(initial.fixtures);
}
function initialItems(s: Evidence) {
  const v = cleanup(s);
  expect(v.bindings.transfers).toEqual([
    {
      item: 'meal-bowl',
      from: 'source-table#r1c1',
      to: 'destination-table#r1c1',
    },
    {
      item: 'work-book',
      from: 'source-table#r1c2',
      to: 'destination-table#r1c2',
    },
    {
      item: 'water-bowl',
      from: 'source-table#r1c3',
      to: 'destination-table#r1c3',
    },
  ]);
  expect(v.items.map((q) => [q.item, q.def, q.contents])).toEqual([
    [
      'meal-bowl',
      'bowl',
      { food: 'hypothetical meal remainder', fraction: 0.25 },
    ],
    ['work-book', 'reading-book', undefined],
    ['water-bowl', 'bowl', { food: 'water', fraction: 0.25 }],
  ]);
  for (const [item, slot] of [
    ['meal-bowl', 'r1c1'],
    ['work-book', 'r1c2'],
    ['water-bowl', 'r1c3'],
  ])
    supported(s, item, 'source-table', slot);
}
function payloads(s: Evidence, initial: Evidence) {
  expect(cleanup(s).items.map((q) => [q.item, q.def, q.contents])).toEqual(
    cleanup(initial).items.map((q) => [q.item, q.def, q.contents]),
  );
}
function clean(s: Evidence) {
  expect(s.violations).toEqual([]);
  expect(s.held).toEqual([]);
  expect(Object.values(s.claims).filter((owners) => owners.length)).toEqual([]);
  expect(s.slots.filter((q) => q.claimedBy !== null)).toEqual([]);
  expect(s.state.humans.filter((h) => h.task !== null)).toEqual([]);
  expect(Object.values(s.hands).filter((h) => h.hands !== null)).toEqual([]);
  expect(
    s.records.filter(
      (r) => !['completed', 'cancelled', 'failed'].includes(r.status),
    ),
  ).toEqual([]);
}
function supported(s: Evidence, item: string, table: string, slot: string) {
  expect(cleanup(s).items.find((q) => q.item === item)?.support).toEqual({
    kind: 'resting-on',
    on: table,
    slot,
  });
}
function held(s: Evidence, item: string) {
  expect(s.held).toHaveLength(1);
  expect(s.held[0]).toMatchObject({ id: item, by: 'tidier', hand: 'right' });
  expect(s.held[0].rendered).not.toBeNull();
  expect(s.held[0].palm).not.toBeNull();
  expect(cleanup(s).items.find((q) => q.item === item)?.support).toEqual({
    kind: 'in-hand',
    by: 'tidier',
    hand: 'right',
  });
  expect(s.hands.tidier.hands?.right).toBeDefined();
  expect(s.bones.tidier).toBeDefined();
  expect(Math.abs(Math.min(...s.bones.tidier.soles))).toBeLessThanOrEqual(0.03);
}
async function waitHeld(page: Page, item: string) {
  await page.waitForFunction((item) => {
    const h = window.__marsEngine;
    return (
      h.heldItems().some((q) => q.id === item && q.by === 'tidier') &&
      h
        .records()
        .some(
          (r) =>
            r.verb === 'take_item' &&
            r.params.item === item &&
            r.status === 'completed',
        )
    );
  }, item);
}
async function waitClean(page: Page) {
  await page.waitForFunction(
    () =>
      window.__marsEngine.tableCleanup()?.mode === 'completed' &&
      window.__marsEngine.heldItems().length === 0 &&
      window.__marsEngine
        .records()
        .every((r) => ['completed', 'cancelled', 'failed'].includes(r.status)),
  );
}
test.afterEach(async ({ page }, info) => {
  const key = info.title.includes('rotated') ? 'rotated' : 'base',
    journey = info.title.includes('End') ? 'end-reset' : 'resume-complete';
  save(`table-cleanup-${key}-${journey}-result`, {
    status: info.status,
    errors: info.errors.map((e) => e.message),
    pageErrors: errors.get(page) ?? [],
    evidence: await inspect(page),
  });
  if (info.status !== info.expectedStatus)
    await capture(page, `table-cleanup-${key}-${journey}-failure`);
});
for (const rotated of [false, true]) {
  const name = rotated ? 'table-cleanup-rotated' : 'table-cleanup',
    key = rotated ? 'rotated' : 'base';
  test(`table cleanup ${key}: actual Play pickup, supported Pause/Resume, player direction and same-object completion`, async ({
    page,
  }) => {
    const fresh = await open(page, name, rotated);
    await button(page, 'Start cleanup').click();
    const initial = await inspect(page);
    initialItems(initial);
    expect(cleanup(initial)).toMatchObject({
      mode: 'tidying',
      completed: [],
      remaining: [
        { item: 'meal-bowl' },
        { item: 'work-book' },
        { item: 'water-bowl' },
      ],
    });
    expect(initial.components).toEqual(fresh.components);
    for (const [item, slot] of [
      ['meal-bowl', 'r1c1'],
      ['work-book', 'r1c2'],
      ['water-bowl', 'r1c3'],
    ])
      supported(initial, item, 'source-table', slot);
    await play(page);
    await waitHeld(page, 'work-book');
    const carrying = await capture(page, `table-cleanup-${key}-real-held-book`);
    held(carrying, 'work-book');
    identities(carrying, initial);
    payloads(carrying, initial);
    expect(cleanup(carrying).completed.map((q) => q.item)).toEqual([
      'meal-bowl',
    ]);
    supported(carrying, 'meal-bowl', 'destination-table', 'r1c1');
    expect(
      carrying.records.some(
        (r) =>
          r.verb === 'take_item' &&
          r.params.item === 'work-book' &&
          r.status === 'completed',
      ),
    ).toBe(true);
    await expect(page.getByTestId('table-cleanup-held')).toContainText(
      'actually held',
    );
    await button(page, 'Pause cleanup').click();
    await play(page);
    await page.waitForFunction(
      () => window.__marsEngine.tableCleanup()?.mode === 'paused',
    );
    const paused = await capture(
      page,
      `table-cleanup-${key}-safe-pause-retained-transfer`,
    );
    expect(cleanup(paused).completed).toEqual(cleanup(carrying).completed);
    supported(paused, 'work-book', 'source-table', 'r1c2');
    expect(paused.held).toEqual([]);
    expect(paused.claims['actor:tidier']).toEqual([]);
    expect(paused.claims['hand:tidier:right']).toEqual([]);
    payloads(paused, initial);
    await expect(button(page, 'Resume cleanup')).toBeEnabled();
    await button(page, 'Resume cleanup').click();
    await play(page);
    await waitHeld(page, 'water-bowl');
    const directedFrom = await capture(
      page,
      `table-cleanup-${key}-real-held-water-bowl`,
    );
    held(directedFrom, 'water-bowl');
    expect(cleanup(directedFrom).completed.map((q) => q.item)).toEqual([
      'meal-bowl',
      'work-book',
    ]);
    payloads(directedFrom, initial);
    await button(page, 'Direct tidier away').click();
    await play(page);
    await page.waitForFunction(() => {
      const h = window.__marsEngine,
        walk = h
          .records()
          .filter(
            (r) =>
              r.verb === 'walk_to' && !r.parent && r.params.actor === 'tidier',
          )
          .at(-1);
      return (
        h.tableCleanup()?.mode === 'waiting' && walk?.status === 'completed'
      );
    });
    const directed = await capture(
      page,
      `table-cleanup-${key}-directed-safe-return`,
    );
    expect(cleanup(directed).diagnostic?.code).toBe('tidy_table.directed-away');
    expect(cleanup(directed).task).toBe(cleanup(initial).task);
    expect(cleanup(directed).completed).toEqual(
      cleanup(directedFrom).completed,
    );
    supported(directed, 'water-bowl', 'source-table', 'r1c3');
    expect(directed.held).toEqual([]);
    expect(directed.claims['actor:tidier']).toEqual([]);
    const destination = rotated ? [5, 0, -5] : [-5, 0, -5];
    expect(directed.state.humans.find((h) => h.id === 'tidier')?.p).toEqual(
      destination,
    );
    await expect(page.getByTestId('table-cleanup-diagnostic')).toContainText(
      'tidy_table.directed-away',
    );
    await expect(button(page, 'Resume cleanup')).toBeEnabled();
    payloads(directed, initial);
    await button(page, 'Resume cleanup').click();
    await play(page);
    await waitClean(page);
    const completed = await capture(
      page,
      `table-cleanup-${key}-completed-same-objects`,
    );
    clean(completed);
    identities(completed, initial);
    payloads(completed, initial);
    expect(cleanup(completed)).toMatchObject({
      task: cleanup(initial).task,
      finished: true,
      mode: 'completed',
      remaining: [],
    });
    expect(cleanup(completed).completed.map((q) => q.item)).toEqual([
      'meal-bowl',
      'work-book',
      'water-bowl',
    ]);
    for (const [item, slot] of [
      ['meal-bowl', 'r1c1'],
      ['work-book', 'r1c2'],
      ['water-bowl', 'r1c3'],
    ])
      supported(completed, item, 'destination-table', slot);
    for (const transfer of cleanup(completed).bindings.transfers)
      expect(
        completed.records.some(
          (r) =>
            r.verb === 'put_item' &&
            r.status === 'completed' &&
            r.params.item === transfer.item &&
            r.params.surfaceSlot === transfer.to,
        ),
      ).toBe(true);
    expect(completed.records.filter((r) => r.status === 'failed')).toEqual([]);
    expect(
      completed.records.some((r) => r.verb === 'walk_to' && !!r.parent),
    ).toBe(true);
    expect(completed.epoch).toBe(initial.epoch);
    await expect(page.getByTestId('table-cleanup-feedback')).toContainText(
      'All actual transfers complete.',
    );
    expect(errors.get(page)).toEqual([]);
    save(`table-cleanup-${key}-play-proof`, {
      fresh,
      initial,
      carrying,
      paused,
      directedFrom,
      directed,
      completed,
    });
  });
  test(`table cleanup ${key}: held End releases resources, same-binding restart admits, Reset removes old task and restores original props`, async ({
    page,
  }) => {
    const fresh = await open(page, name, rotated);
    await button(page, 'Start cleanup').click();
    const initial = await inspect(page);
    initialItems(initial);
    await play(page);
    await waitHeld(page, 'meal-bowl');
    const carrying = await capture(
      page,
      `table-cleanup-${key}-end-held-meal-bowl`,
    );
    held(carrying, 'meal-bowl');
    expect(cleanup(carrying).completed).toEqual([]);
    await button(page, 'End cleanup').click();
    await play(page);
    await waitClean(page);
    const ended = await capture(
      page,
      `table-cleanup-${key}-end-supported-clean`,
    );
    clean(ended);
    identities(ended, initial);
    payloads(ended, initial);
    expect(cleanup(ended)).toMatchObject({
      mode: 'completed',
      finished: false,
      completed: [],
    });
    initialItems(ended);
    expect(ended.components).toEqual(initial.components);
    expect(
      ended.records.find((r) => r.id === cleanup(ended).task)?.status,
    ).toBe('cancelled');
    await expect(page.getByTestId('table-cleanup-feedback')).toContainText(
      'Cleanup ended early.',
    );
    // Re-admission of the exact binding proves logical task/item/surface-slot
    // release even though the existing hook exposes only principal claims.
    await expect(button(page, 'Start cleanup')).toBeEnabled();
    await button(page, 'Start cleanup').click();
    const restart = await inspect(page);
    expect(cleanup(restart).mode).toBe('tidying');
    expect(cleanup(restart).task).not.toBe(cleanup(ended).task);
    expect(restart.records.filter((r) => r.status === 'failed')).toEqual([]);
    expect(restart.claims['entity:meal-bowl']).toEqual([cleanup(restart).task]);
    await button(page, 'Reset').click();
    await button(page, 'Step').click();
    const reset = await capture(
      page,
      `table-cleanup-${key}-reset-original-supports`,
    );
    clean(reset);
    expect(reset.epoch).toBeGreaterThan(initial.epoch);
    expect(reset.cleanup).toBeNull();
    expect(reset.records).toEqual([]);
    expect(reset.components).toEqual(fresh.components);
    expect(reset.fixtures).toEqual(fresh.fixtures);
    await expect(button(page, 'Resume cleanup')).toBeDisabled();
    await expect(button(page, 'End cleanup')).toBeDisabled();
    await expect(page.getByTestId('table-cleanup-items')).toContainText(
      'hypothetical meal remainder: 0.2500 bowl',
    );
    expect(errors.get(page)).toEqual([]);
    save(`table-cleanup-${key}-end-reset-proof`, {
      fresh,
      initial,
      carrying,
      ended,
      restart,
      reset,
    });
  });
}
