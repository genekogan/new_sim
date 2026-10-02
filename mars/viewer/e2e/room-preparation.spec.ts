/// <reference types="node" />
import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
import type { readRoomPreparation } from '../engine/activities/room-preparation.ts';
declare global {
  interface Window {
    __marsEngine: EngineHook;
  }
}
// Root wires this minimal detached observation hook; this lane edits no shared API.
type RoomHook = EngineHook & {
  roomPreparation: () => ReturnType<typeof readRoomPreparation> | null;
};
const source = {
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  trackedChanges: execFileSync('git', ['diff', '--name-only', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
};
const directory = path.resolve(
  'e2e/artifacts',
  process.env.E2E_RUN ?? 'room-preparation',
);
const errors = new WeakMap<Page, string[]>();
const button = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true });
async function inspect(page: Page) {
  return page.evaluate(() => {
    const h = window.__marsEngine as RoomHook;
    return {
      state: h.state(),
      epoch: h.scenarioEpoch,
      room: h.roomPreparation(),
      records: h.records(),
      violations: h.violations(),
      components: h.components(),
      fixtures: h.fixtures(),
      entities: h.cameraEntities(),
      held: h.heldItems(),
      hands: h.humanFields(),
      bones: h.bones(),
      slots: h.slots(),
      claims: h.garden().claims,
      attention: h.activityAttentionTargets(),
      cameraFacts: h.cameraActivityReadout(),
    };
  });
}
type Evidence = Awaited<ReturnType<typeof inspect>>;
function room(s: Evidence) {
  if (!s.room) throw Error('Expected actual room preparation');
  return s.room;
}
function save(name: string, evidence: unknown) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, `${name}.json`),
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
async function capture(page: Page, name: string, verify = true) {
  await freeze(page);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.getByTestId('room-preparation-readout').scrollIntoViewIfNeeded();
  const s = await inspect(page);
  if (verify) expect(s.violations).toEqual([]);
  await page.screenshot({ path: path.join(directory, `${name}.png`) });
  writeFileSync(
    path.join(directory, `${name}.a11y.yml`),
    await page.locator('body').ariaSnapshot(),
  );
  save(name, s);
  return s;
}
async function camera(
  page: Page,
  p: [number, number, number],
  target: [number, number, number],
) {
  await page.evaluate(
    ({ p, target }) => window.__marsEngine.camera(p, target),
    { p, target },
  );
}
async function reset(page: Page) {
  await button(page, 'Reset').click();
  expect(await page.evaluate(() => window.__marsEngine.records())).toEqual([]);
  await button(page, 'Step').click(); // Readiness only; all activity execution below uses actual Play.
  const s = await inspect(page);
  expect(s.state.tick).toBe(1);
  expect(s.room).toBeNull();
  expect(s.fixtures.find((e) => e.id === 'belongings-table')?.pose.p).toEqual([
    10, 0, -5,
  ]);
  expect(s.fixtures.find((e) => e.id === 'seat8')?.pose.p).toEqual([4.5, 0, 3]);
  clean(s);
  return s;
}
async function open(page: Page) {
  mkdirSync(directory, { recursive: true });
  const log: string[] = [];
  errors.set(page, log);
  page.on('pageerror', (e) => log.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error') log.push(e.text());
  });
  await page.goto('/lab?scenario=room-preparation');
  await page.waitForFunction(() => window.__marsEngine?.ready, undefined, {
    timeout: 15_000,
  });
  await page.evaluate(() =>
    window.__marsEngine.runScenario('room-preparation', {
      paused: true,
      speed: 4,
    }),
  );
  const s = await reset(page);
  await expect(page.getByTestId('room-preparation-hud')).toContainText(
    'Hypothetical classroom',
  );
  await expect(button(page, 'Start room preparation')).toBeEnabled();
  expect(s.state.speed).toBe(4);
  return s;
}
function clean(s: Evidence) {
  expect(s.violations).toEqual([]);
  expect(s.held).toEqual([]);
  expect(Object.values(s.claims).filter((owners) => owners.length)).toEqual([]);
  expect(s.slots.filter((v) => v.claimedBy !== null)).toEqual([]);
  expect(s.state.humans.filter((h) => h.task !== null)).toEqual([]);
  expect(Object.values(s.hands).filter((h) => h.hands !== null)).toEqual([]);
  expect(
    s.records.filter((r) => !['completed', 'cancelled'].includes(r.status)),
  ).toEqual([]);
}
function identities(s: Evidence, initial: Evidence) {
  expect(s.components.map((e) => [e.id, e.def])).toEqual(
    initial.components.map((e) => [e.id, e.def]),
  );
  expect(s.fixtures.map((e) => [e.id, e.def])).toEqual(
    initial.fixtures.map((e) => [e.id, e.def]),
  );
  expect(s.entities.map((e) => e.id).sort()).toEqual(
    initial.entities.map((e) => e.id).sort(),
  );
  expect(s.state.humans.map((h) => h.id).sort()).toEqual(
    initial.state.humans.map((h) => h.id).sort(),
  );
  expect(
    s.fixtures.filter((e) => !['belongings-table', 'seat8'].includes(e.id)),
  ).toEqual(
    initial.fixtures.filter(
      (e) => !['belongings-table', 'seat8'].includes(e.id),
    ),
  );
}
const payloads = (s: Evidence) =>
  room(s).storedItems.map((t) => ({
    item: t.item,
    id: t.actual?.id,
    def: t.actual?.def,
    provenance: t.actual?.provenance,
    contents: t.actual?.contents,
    equipment: t.actual?.equipment,
  }));
function unchanged(s: Evidence, initial: Evidence, admitted: Evidence) {
  identities(s, initial);
  expect(payloads(s)).toEqual(payloads(admitted));
  expect(s.violations).toEqual([]);
}
function stored(s: Evidence) {
  expect(room(s).tidy?.finished).toBe(true);
  expect(room(s).tidy?.completed).toHaveLength(2);
  for (const t of room(s).storedItems)
    expect(t.actual?.support).toEqual({
      kind: 'resting-on',
      on: 'storage-table',
      slot: t.to.split('#')[1],
    });
  expect(s.held).toEqual([]);
}
function layout(s: Evidence) {
  for (const p of room(s).placements) {
    expect(p.atTarget).toBe(true);
    expect(p.support).toEqual({ kind: 'ground' });
  }
  expect(s.fixtures.find((e) => e.id === 'belongings-table')?.pose.p).toEqual([
    12, 0, -2,
  ]);
  expect(s.fixtures.find((e) => e.id === 'seat8')?.pose.p).toEqual([7.5, 0, 3]);
}
async function waitMode(page: Page, mode: 'paused' | 'completed') {
  await page.waitForFunction(
    (wanted) =>
      (window.__marsEngine as RoomHook).roomPreparation()?.mode === wanted,
    mode,
    { timeout: 15_000 },
  );
}
test.afterEach(async ({ page }, info) => {
  const name = info.title.startsWith('connected')
    ? 'room-preparation-connected'
    : info.title.startsWith('active')
      ? 'room-preparation-active-end'
      : 'room-preparation-early-end';
  save(`${name}-result`, {
    status: info.status,
    errors: info.errors.map((e) => e.message),
    pageErrors: errors.get(page) ?? [],
    state: await inspect(page),
  });
  if (info.status !== info.expectedStatus)
    await capture(page, `${name}-failure`, false);
});

test('connected actual Play: held bowl safe Pause, carried table safe retry, same stored objects and moved-seat classroom questions through full finish', async ({
  page,
}) => {
  const initial = await open(page);
  await camera(page, [13, 3, -8], [10, 0.8, -5]);
  await button(page, 'Start room preparation').click();
  const admitted = await inspect(page);
  expect(room(admitted).ownedActions).toEqual([]);
  expect(room(admitted).storedItems.map((t) => t.actual?.support)).toEqual([
    { kind: 'resting-on', on: 'belongings-table', slot: 'r1c1' },
    { kind: 'resting-on', on: 'belongings-table', slot: 'r1c2' },
  ]);
  await play(page);
  await page.waitForFunction(
    () => {
      const s = (window.__marsEngine as RoomHook).roomPreparation();
      return (
        s?.tidy?.current?.item === 'break-bowl' &&
        s.tidy.current.held === true &&
        s.storedItems.find((t) => t.item === 'break-bowl')?.actual?.support
          ?.kind === 'in-hand'
      );
    },
    undefined,
    { timeout: 15_000 },
  );
  const heldBowl = await capture(page, 'room-preparation-actual-held-bowl');
  unchanged(heldBowl, initial, admitted);
  expect(heldBowl.held.find((e) => e.id === 'break-bowl')).toMatchObject({
    by: 'worker',
    hand: 'right',
  });
  expect(
    room(heldBowl).storedItems.find((t) => t.item === 'break-bowl')?.actual
      ?.support,
  ).toEqual({ kind: 'in-hand', by: 'worker', hand: 'right' });
  expect(
    heldBowl.held.find((e) => e.id === 'break-bowl')?.rendered,
  ).not.toBeNull();
  expect(heldBowl.held.find((e) => e.id === 'break-bowl')?.palm).not.toBeNull();
  expect(heldBowl.hands.worker.hands?.right).toHaveLength(3);
  expect(heldBowl.bones.worker).toBeDefined();
  expect(
    Math.abs(Math.min(...heldBowl.bones.worker.soles)),
  ).toBeLessThanOrEqual(0.03);
  const tidy = room(heldBowl).tidy!.task;
  await button(page, 'Pause preparation').click();
  await expect(button(page, 'Resume preparation')).toBeDisabled();
  await play(page);
  await waitMode(page, 'paused');
  const paused = await capture(page, 'room-preparation-safe-bowl-return');
  unchanged(paused, initial, admitted);
  expect(room(paused).tidy?.task).toBe(tidy);
  expect(room(paused).tidy?.completed).toEqual(room(heldBowl).tidy?.completed);
  expect(paused.held).toEqual([]);
  for (const t of room(paused).storedItems)
    expect(t.actual?.support?.kind).toBe('resting-on');
  const pausedTick = paused.state.tick;
  await play(page);
  await page.waitForFunction(
    (tick) => window.__marsEngine.state().tick >= tick + 12,
    pausedTick,
    { timeout: 15_000 },
  );
  await freeze(page);
  const retained = await inspect(page);
  expect(room(retained).tidy).toEqual(room(paused).tidy);
  expect(room(retained).storedItems).toEqual(room(paused).storedItems);
  await button(page, 'Resume preparation').click();
  await play(page);
  await page.waitForFunction(
    () => {
      const s = (window.__marsEngine as RoomHook).roomPreparation();
      return (
        s?.stage === 'arranging' &&
        s.setup?.current?.phase === 'move' &&
        s.setup.current.fixture === 'belongings-table' &&
        s.setup.current.held &&
        !!s.placements.find(
          (p) =>
            p.fixture === 'belongings-table' &&
            p.pose &&
            Math.hypot(p.pose.p[0] - 10, p.pose.p[2] + 5) > 0.1,
        )
      );
    },
    undefined,
    { timeout: 15_000 },
  );
  await freeze(page);
  const moving = await inspect(page),
    table = room(moving).placements.find(
      (p) => p.fixture === 'belongings-table',
    )!;
  await camera(
    page,
    [table.pose!.p[0] + 3, 3, table.pose!.p[2] + 4],
    [table.pose!.p[0], 0.8, table.pose!.p[2]],
  );
  const heldTable = await capture(
    page,
    'room-preparation-actual-two-person-table-carry',
  );
  unchanged(heldTable, initial, admitted);
  stored(heldTable);
  expect(room(heldTable).tidy?.task).toBe(tidy);
  expect(room(heldTable).setup?.current?.crew).toEqual(['guest1', 'guest2']);
  expect(
    room(heldTable).placements.find((p) => p.fixture === 'belongings-table')
      ?.support,
  ).toEqual({ kind: 'held', by: ['guest1', 'guest2'] });
  expect(
    heldTable.fixtures.find((e) => e.id === 'belongings-table')?.rendered?.p[1],
  ).toBeGreaterThan(0);
  for (const actor of ['guest1', 'guest2']) {
    expect(heldTable.state.humans.find((h) => h.id === actor)?.activity).toBe(
      'carry',
    );
    expect(heldTable.bones[actor].activity).toBe('carry');
    expect(
      Math.abs(Math.min(...heldTable.bones[actor].soles)),
    ).toBeLessThanOrEqual(0.03);
  }
  const oldSetup = room(heldTable).setup!.action;
  await button(page, 'Pause preparation').click();
  await play(page);
  await waitMode(page, 'paused');
  const partialLayout = await capture(
    page,
    'room-preparation-safe-partial-ground-layout',
  );
  unchanged(partialLayout, initial, admitted);
  stored(partialLayout);
  expect(room(partialLayout).setup?.partial).toBe(true);
  expect(room(partialLayout).setup?.ready).toBe(false);
  expect(
    room(partialLayout).placements.find((p) => p.fixture === 'belongings-table')
      ?.support,
  ).toEqual({ kind: 'ground' });
  expect(
    room(partialLayout).placements.find((p) => p.fixture === 'belongings-table')
      ?.atTarget,
  ).toBe(false);
  await expect(page.getByTestId('room-preparation-hud')).toContainText(
    'explicit new physical setup attempt',
  );
  await button(page, 'Resume preparation').click();
  expect(room(await inspect(page)).tidy?.task).toBe(tidy);
  await play(page);
  await page.waitForFunction(
    () => {
      const s = (window.__marsEngine as RoomHook).roomPreparation();
      return (
        s?.stage === 'gathering' &&
        s.placements.every((p) => p.atTarget && p.support?.kind === 'ground')
      );
    },
    undefined,
    { timeout: 15_000 },
  );
  await page.waitForFunction(
    () =>
      (window.__marsEngine as RoomHook).roomPreparation()?.session?.phase ===
      'presenting',
    undefined,
    { timeout: 15_000 },
  );
  await freeze(page);
  const ready = await inspect(page);
  unchanged(ready, initial, admitted);
  stored(ready);
  layout(ready);
  expect(room(ready).setup?.action).not.toBe(oldSetup);
  expect(ready.records.filter((r) => r.verb === 'tidy_table')).toHaveLength(1);
  save('room-preparation-room-ready-before-join', ready);
  await expect(button(page, 'Pause preparation')).toBeDisabled();
  await expect(page.getByTestId('room-preparation-pause-limit')).toContainText(
    'room_preparation.session-pause-unsupported',
  );
  await expect(page.getByTestId('room-preparation-pause-limit')).toContainText(
    'Global Pause freezes',
  );
  await button(page, 'Join visitor').click();
  await play(page);
  await page.waitForFunction(
    () =>
      (window.__marsEngine as RoomHook)
        .roomPreparation()
        ?.session?.participants.find((p) => p.actor === 'visitor')?.arrival ===
      'seated',
    undefined,
    { timeout: 15_000 },
  );
  await freeze(page);
  await camera(page, [10, 3, 6], [7.5, 0.6, 3]);
  const visitor = await capture(
    page,
    'room-preparation-relocated-chair-actually-used',
  );
  unchanged(visitor, initial, admitted);
  stored(visitor);
  layout(visitor);
  expect(
    room(visitor).session?.participants.find((p) => p.actor === 'visitor'),
  ).toMatchObject({
    state: 'participating',
    arrival: 'seated',
    seat: 'seat8#seat',
  });
  expect(visitor.slots.find((s) => s.id === 'seat8#seat')).toMatchObject({
    occupant: 'visitor',
    claimant: 'visitor',
    state: 'occupied',
  });
  expect(visitor.bones.visitor.activity).toBe('sit');
  expect(visitor.state.humans.find((h) => h.id === 'visitor')?.activity).toBe(
    'sit',
  );
  await button(page, 'Ask visitor').click();
  await play(page);
  await page.waitForFunction(
    () => {
      const s = (window.__marsEngine as RoomHook).roomPreparation()?.session;
      return s?.phase === 'question' && s.floorHolder === 'visitor';
    },
    undefined,
    { timeout: 15_000 },
  );
  const question = await capture(
    page,
    'room-preparation-visitor-real-question-floor',
  );
  unchanged(question, initial, admitted);
  layout(question);
  expect(room(question).session?.attentionTarget?.actor).toBe('visitor');
  expect(room(question).session?.presenter).toBe('presenter1');
  await play(page);
  await page.waitForFunction(
    () => {
      const s = (window.__marsEngine as RoomHook).roomPreparation()?.session;
      return s?.phase === 'presenting' && s.floorHolder === 'presenter1';
    },
    undefined,
    { timeout: 15_000 },
  );
  await freeze(page);
  await button(page, 'Advance presenter').click();
  await play(page);
  await page.waitForFunction(
    () => {
      const s = (window.__marsEngine as RoomHook).roomPreparation()?.session;
      return s?.phase === 'presenting' && s.floorHolder === 'presenter2';
    },
    undefined,
    { timeout: 15_000 },
  );
  await freeze(page);
  const rotation = await inspect(page);
  expect(room(rotation).session?.attentionTarget?.actor).toBe('presenter2');
  save('room-preparation-actual-presenter-rotation', rotation);
  await camera(page, [0, 8, 18], [0, 0.8, 6]);
  await play(page);
  await page.waitForFunction(
    () => {
      const s = (window.__marsEngine as RoomHook).roomPreparation()?.session;
      return (
        s?.phase === 'conversing' &&
        s.groups.length === 2 &&
        s.groups.every(
          (g) =>
            g.status === 'talking' && g.members.length >= 2 && !!g.floorHolder,
        )
      );
    },
    undefined,
    { timeout: 15_000 },
  );
  const conversations = await capture(
    page,
    'room-preparation-actual-conversation-groups',
  );
  unchanged(conversations, initial, admitted);
  stored(conversations);
  layout(conversations);
  for (const g of room(conversations).session!.groups)
    expect(g.attentionTarget?.actor).toBe(g.floorHolder);
  await play(page);
  await waitMode(page, 'completed');
  const completed = await capture(page, 'room-preparation-full-chain-complete');
  unchanged(completed, initial, admitted);
  stored(completed);
  layout(completed);
  clean(completed);
  expect(room(completed).finished).toBe(true);
  expect(room(completed).status).toBe('completed');
  expect(room(completed).session?.phase).toBe('ended');
  await expect(page.getByTestId('room-preparation-readout')).toContainText(
    'completed',
  );
  expect(completed.records.filter((r) => r.verb === 'tidy_table')).toHaveLength(
    1,
  );
  expect(completed.records.filter((r) => r.verb === 'setup_room')).toHaveLength(
    2,
  );
  expect(
    completed.records.filter((r) => r.verb === 'classroom_session'),
  ).toHaveLength(1);
  expect(completed.records.filter((r) => r.status === 'failed')).toEqual([]);
  expect(errors.get(page)).toEqual([]);
  const resetState = await reset(page);
  expect(resetState.epoch).toBeGreaterThan(initial.epoch);
  await expect(button(page, 'Start room preparation')).toBeEnabled();
  save('room-preparation-connected-proof', {
    initial,
    admitted,
    heldBowl,
    paused,
    retained,
    heldTable,
    partialLayout,
    ready,
    visitor,
    question,
    rotation,
    conversations,
    completed,
    resetState,
  });
});

test('pre-first-tick End uses actual Play cleanup then Reset firstStep leaves no children or stale preparation', async ({
  page,
}) => {
  const initial = await open(page);
  await button(page, 'Start room preparation').click();
  const admitted = await inspect(page);
  expect(admitted.state.tick).toBe(initial.state.tick);
  expect(room(admitted).ownedActions).toEqual([]);
  await button(page, 'End preparation').click();
  expect(room(await inspect(page)).mode).toBe('ending');
  await play(page);
  await waitMode(page, 'completed');
  const ended = await capture(page, 'room-preparation-pre-first-tick-End');
  expect(room(ended).status).toBe('cancelled');
  expect(room(ended).finished).toBe(false);
  expect(room(ended).ownedActions).toEqual([]);
  expect(ended.records.filter((r) => r.parent)).toEqual([]);
  expect(ended.fixtures).toEqual(initial.fixtures);
  expect(ended.components).toEqual(initial.components);
  clean(ended);
  await expect(page.getByTestId('room-preparation-readout')).toContainText(
    'ended',
  );
  const resetState = await reset(page);
  expect(resetState.epoch).toBeGreaterThan(initial.epoch);
  expect(resetState.fixtures).toEqual(initial.fixtures);
  expect(resetState.components).toEqual(initial.components);
  await expect(button(page, 'Start room preparation')).toBeEnabled();
  expect(errors.get(page)).toEqual([]);
  save('room-preparation-early-End-proof', {
    initial,
    admitted,
    ended,
    resetState,
  });
});

test('active held-table End uses actual Play ground setdown and drains without starting classroom or claiming finished', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const initial = await open(page);
  await button(page, 'Start room preparation').click();
  const admitted = await inspect(page);
  await play(page);
  await page.waitForFunction(
    () => {
      const s = (window.__marsEngine as RoomHook).roomPreparation();
      return (
        s?.stage === 'arranging' &&
        s.setup?.current?.phase === 'move' &&
        s.setup.current.fixture === 'belongings-table' &&
        s.setup.current.held &&
        !!s.placements.find(
          (p) =>
            p.fixture === 'belongings-table' &&
            p.pose &&
            Math.hypot(p.pose.p[0] - 10, p.pose.p[2] + 5) > 0.1,
        )
      );
    },
    undefined,
    { timeout: 15_000 },
  );
  await freeze(page);
  const moving = await inspect(page),
    table = room(moving).placements.find(
      (p) => p.fixture === 'belongings-table',
    )!;
  await camera(
    page,
    [table.pose!.p[0] + 3, 3, table.pose!.p[2] + 4],
    [table.pose!.p[0], 0.8, table.pose!.p[2]],
  );
  const heldTable = await capture(page, 'room-preparation-End-held-table');
  unchanged(heldTable, initial, admitted);
  stored(heldTable);
  expect(room(heldTable).setup?.current?.crew).toEqual(['guest1', 'guest2']);
  expect(
    room(heldTable).placements.find((p) => p.fixture === 'belongings-table')
      ?.support,
  ).toEqual({ kind: 'held', by: ['guest1', 'guest2'] });
  expect(
    heldTable.fixtures.find((e) => e.id === 'belongings-table')?.rendered?.p[1],
  ).toBeGreaterThan(0);
  for (const actor of ['guest1', 'guest2'])
    expect(heldTable.bones[actor].activity).toBe('carry');
  await button(page, 'End preparation').click();
  expect(room(await inspect(page)).mode).toBe('ending');
  await expect(button(page, 'Resume preparation')).toBeDisabled();
  await play(page);
  await waitMode(page, 'completed');
  const ended = await capture(page, 'room-preparation-End-supported-ground');
  unchanged(ended, initial, admitted);
  stored(ended);
  clean(ended);
  expect(room(ended).status).toBe('cancelled');
  expect(room(ended).finished).toBe(false);
  expect(room(ended).setup?.partial).toBe(true);
  expect(room(ended).session).toBeUndefined();
  expect(ended.records.filter((r) => r.verb === 'classroom_session')).toEqual(
    [],
  );
  const grounded = room(ended).placements.find(
    (p) => p.fixture === 'belongings-table',
  )!;
  expect(grounded.support).toEqual({ kind: 'ground' });
  expect(grounded.pose?.p[1]).toBe(0);
  expect(grounded.atTarget).toBe(false);
  await expect(page.getByTestId('room-preparation-readout')).toContainText(
    'ended',
  );
  await play(page);
  await page.waitForFunction(
    (tick) => window.__marsEngine.state().tick >= tick + 12,
    ended.state.tick,
    { timeout: 15_000 },
  );
  await freeze(page);
  const retained = await inspect(page);
  expect(retained.records).toEqual(ended.records);
  expect(retained.fixtures).toEqual(ended.fixtures);
  expect(room(retained).storedItems).toEqual(room(ended).storedItems);
  clean(retained);
  expect(errors.get(page)).toEqual([]);
  save('room-preparation-active-End-proof', {
    initial,
    admitted,
    heldTable,
    ended,
    retained,
  });
});
