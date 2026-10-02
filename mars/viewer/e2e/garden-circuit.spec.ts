/// <reference types="node" />
import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
import type { readGardenCircuit } from '../engine/activities/garden-circuit.ts';
declare global {
  interface Window {
    __marsEngine: EngineHook;
  }
}
type CircuitHook = EngineHook & {
  gardenCircuit: () => ReturnType<typeof readGardenCircuit> | null;
};
const source = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
  directory = path.resolve(
    'e2e/artifacts',
    process.env.E2E_RUN ?? `garden-circuit-${source.slice(0, 7)}`,
  );
const button = (p: Page, name: string) =>
  p.getByRole('button', { name, exact: true });
async function inspect(p: Page) {
  return p.evaluate(() => {
    const h = window.__marsEngine as CircuitHook;
    return {
      circuit: h.gardenCircuit(),
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
  if (!s.circuit) throw Error('Missing authoritative garden circuit');
  return s.circuit;
}
function garden(s: Snapshot, id: string) {
  const g = read(s).plants.find((g) => !('code' in g) && g.plant === id);
  if (!g || 'code' in g) throw Error(`Missing actual ${id} care state`);
  return g;
}
function conserved(s: Snapshot) {
  const c = read(s),
    gardens = c.plants.map((g) => {
      if ('code' in g) throw Error(g.message);
      return g;
    });
  expect({
    source: c.source.id,
    sourceFood: c.source.contents?.food,
    sourceSupport: c.source.support,
    bowl: c.water.id,
    bowlFood: c.water.contents?.food,
    violations: s.violations,
  }).toEqual({
    source: 'water-pot',
    sourceFood: 'water',
    sourceSupport: { kind: 'resting-on', on: 'water-table', slot: 'r1c2' },
    bowl: 'water-bowl',
    bowlFood: 'water',
    violations: [],
  });
  for (const q of [c.source.contents!.fraction, c.water.contents!.fraction]) {
    expect(Number.isFinite(q)).toBe(true);
    expect(q).toBeGreaterThanOrEqual(0);
    expect(q).toBeLessThanOrEqual(1);
  }
  expect(
    4 * c.source.contents!.fraction +
      c.water.contents!.fraction +
      gardens.reduce((n, g) => n + g.waterReceived, 0),
  ).toBe(2);
  expect(gardens.map((g) => g.plant)).toEqual([
    'plant-a',
    'plant-b',
    'plant-c',
  ]);
}
function released(s: Snapshot) {
  expect({
    held: s.held,
    claims: read(s).claims.filter((c) => c.holders.length),
    slots: s.slots.filter((s) => s.claimedBy !== null),
    active: s.records.filter(
      (r) => !['completed', 'cancelled'].includes(r.status),
    ),
    violations: s.violations,
  }).toEqual({ held: [], claims: [], slots: [], active: [], violations: [] });
}
async function play(p: Page) {
  if (await p.evaluate(() => window.__marsEngine.state().paused))
    await button(p, 'Play').click();
}
async function freeze(p: Page) {
  if (!(await p.evaluate(() => window.__marsEngine.state().paused)))
    await button(p, 'Pause').click();
}
async function capture(p: Page, name: string, focus = 'water-table') {
  await freeze(p);
  await p.evaluate((focus) => {
    const h = window.__marsEngine,
      e = h.cameraEntities().find((e) => e.id === focus);
    if (e) {
      const t: [number, number, number] = [
        e.pose.p[0],
        e.pose.p[1] + 0.8,
        e.pose.p[2],
      ];
      h.camera([t[0] + 3.5, t[1] + 2.8, t[2] - 4], t);
    }
  }, focus);
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
type Phase =
  | 'refill'
  | 'paused'
  | 'partial-care'
  | 'due-a'
  | 'second-a'
  | 'due-b'
  | 'second-b'
  | 'second-refill'
  | 'due-c'
  | 'completed'
  | 'ended';
async function wait(p: Page, phase: Phase) {
  await p.waitForFunction(
    (phase) => {
      const c = (window.__marsEngine as CircuitHook).gardenCircuit();
      if (!c) return false;
      const g = (id: string) =>
        c.plants.find((g) => !('code' in g) && g.plant === id);
      if (phase === 'refill')
        return (
          c.current?.verb === 'serve' &&
          c.current.phase === 'back' &&
          c.source.contents?.fraction === 0.25 &&
          c.water.contents?.fraction === 1
        );
      if (phase === 'paused') return c.mode === 'paused';
      if (phase === 'partial-care') {
        const a = g('plant-a');
        return (
          a &&
          !('code' in a) &&
          !!a.pending &&
          a.pending.delivered > 0 &&
          a.pending.delivered < 0.25 &&
          c.current?.verb === 'garden_care'
        );
      }
      if (phase === 'second-refill')
        return (
          c.source.contents?.fraction === 0 &&
          c.water.contents?.fraction === 1 &&
          c.current?.verb === 'serve' &&
          c.current.phase === 'back'
        );
      if (phase === 'completed') return c.finished && c.mode === 'completed';
      if (phase === 'ended') return c.mode === 'ended' && !c.finished;
      const id = phase.endsWith('a')
          ? 'plant-a'
          : phase.endsWith('b')
            ? 'plant-b'
            : 'plant-c',
        a = g(id);
      if (!a || 'code' in a) return false;
      if (phase.startsWith('due'))
        return (
          a.cycles === 1 &&
          !a.due &&
          a.remainingTicks > 0 &&
          !c.current &&
          c.diagnostic?.code === 'garden_circuit.not-due' &&
          c.water.support?.kind === 'resting-on'
        );
      return a.cycles === 2;
    },
    phase,
    { timeout: 15_000 },
  );
}
async function setup(p: Page) {
  await p.goto('/lab?scenario=garden-circuit');
  await p.waitForFunction(
    () =>
      window.__marsEngine?.ready &&
      typeof (window.__marsEngine as CircuitHook).gardenCircuit === 'function',
    undefined,
    { timeout: 15_000 },
  );
  await p.evaluate(() =>
    window.__marsEngine.runScenario('garden-circuit', {
      paused: true,
      speed: 4,
    }),
  );
  await button(p, 'Reset').click();
  await button(p, 'Step').click(); // Fresh readiness only; the journeys use actual Play.
  expect((await inspect(p)).records).toEqual([]);
  await expect(p.getByTestId('garden-circuit-hud')).toContainText(
    'Hypothetical ground planters',
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
  const name = info.title.startsWith('finite') ? 'finite' : 'end-reset';
  mkdirSync(directory, { recursive: true });
  if (info.status !== info.expectedStatus) {
    try {
      await capture(page, `${name}-failure`);
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
test('finite two-refill six-care circuit retains real material across Pause, direction and due waiting under Play', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const consoleErrors = errors(page);
  await setup(page);
  await button(page, 'Start circuit').click();
  const initial = await inspect(page),
    initialSource = read(initial).source,
    initialWater = read(initial).water,
    ids = initial.entities.map((e) => e.id).sort(),
    circuit = read(initial).circuit;
  await play(page);
  await wait(page, 'refill');
  const filled = await capture(
    page,
    'finite-first-refill-actual-committed-water',
  );
  conserved(filled);
  expect({
    source: read(filled).source.contents!.fraction,
    bowl: read(filled).water.contents!.fraction,
    support: read(filled).water.support,
    phase: read(filled).current!.phase,
  }).toEqual({
    source: 0.25,
    bowl: 1,
    support: { kind: 'in-hand', by: 'carer', hand: 'right' },
    phase: 'back',
  });
  const firstServe = read(filled).current!.id;
  await button(page, 'Pause circuit').click();
  await play(page);
  await wait(page, 'paused');
  const refillPaused = await capture(
    page,
    'finite-committed-refill-safe-pause',
  );
  conserved(refillPaused);
  expect({
    pot: read(refillPaused).source.contents!.fraction,
    bowl: read(refillPaused).water.contents!.fraction,
    support: read(refillPaused).water.support,
    firstServe: read(refillPaused).history.find((r) => r?.id === firstServe)
      ?.status,
  }).toEqual({
    pot: 0.25,
    bowl: 1,
    support: { kind: 'resting-on', on: 'water-table', slot: 'r0c2' },
    firstServe: 'cancelled',
  });
  await button(page, 'Resume circuit').click();
  await play(page);
  await wait(page, 'partial-care');
  const partial = await capture(
    page,
    'finite-real-partial-first-care',
    'plant-a',
  );
  conserved(partial);
  const pending = garden(partial, 'plant-a').pending!;
  expect(pending.water).toBe('water-bowl');
  expect(pending.delivered).toBeGreaterThan(0);
  expect(pending.delivered).toBeLessThan(0.25);
  expect(read(partial).history.filter((r) => r?.verb === 'serve')).toHaveLength(
    1,
  );
  expect(read(partial).water.support).toEqual({
    kind: 'in-hand',
    by: 'carer',
    hand: 'right',
  });
  await button(page, 'Pause circuit').click();
  await play(page);
  await wait(page, 'paused');
  const carePaused = await capture(
    page,
    'finite-partial-purpose-safe-supported-pause',
    'plant-a',
  );
  conserved(carePaused);
  expect(garden(carePaused, 'plant-a').pending).toEqual(pending);
  expect(read(carePaused).water.support).toEqual({
    kind: 'resting-on',
    on: 'water-table',
    slot: 'r0c2',
  });
  await button(page, 'Direct carer away').click();
  await play(page);
  await page.waitForFunction(
    () =>
      window.__marsEngine
        .records()
        .some(
          (r) =>
            r.verb === 'walk_to' &&
            !r.parent &&
            (r.params as { actor?: string }).actor === 'carer' &&
            r.status === 'completed',
        ),
    undefined,
    { timeout: 15_000 },
  );
  await wait(page, 'paused');
  const directed = await capture(
    page,
    'finite-ordinary-direction-retained-care',
    'plant-a',
  );
  conserved(directed);
  expect(read(directed).circuit).toBe(circuit);
  expect(garden(directed, 'plant-a').pending).toEqual(pending);
  await expect(button(page, 'Resume circuit')).toBeEnabled();
  await button(page, 'Resume circuit').click();
  await play(page);
  await wait(page, 'due-a');
  const due = await capture(
      page,
      'finite-genuine-600-tick-first-bed-wait',
      'plant-a',
    ),
    a = garden(due, 'plant-a');
  conserved(due);
  expect({
    cycles: a.cycles,
    received: a.waterReceived,
    interval: a.intervalTicks,
    due: a.due,
    support: read(due).water.support,
    child: read(due).current,
    held: due.held,
  }).toEqual({
    cycles: 1,
    received: 0.25,
    interval: 600,
    due: false,
    support: { kind: 'resting-on', on: 'water-table', slot: 'r0c2' },
    child: undefined,
    held: [],
  });
  expect(a.remainingTicks).toBe(a.lastCareTick! + 600 - due.state.tick);
  expect(a.remainingTicks).toBeGreaterThan(0);
  expect(a.remainingTicks).toBeLessThanOrEqual(600);
  expect(
    read(due).claims.find((c) => c.resource === 'actor:carer')?.holders,
  ).toEqual([]);
  await expect(page.getByTestId('garden-circuit-due')).toContainText(
    'ordinary ticks',
  );
  await play(page);
  await wait(page, 'second-a');
  const secondA = await capture(
    page,
    'finite-first-bed-second-due-cycle-actual',
    'plant-a',
  );
  conserved(secondA);
  const secondCare = read(secondA)
    .history.filter(
      (r) =>
        r?.verb === 'garden_care' &&
        (r.params as { plant?: string }).plant === 'plant-a',
    )
    .at(-1)!;
  expect(secondCare.requestedTick).toBeGreaterThanOrEqual(
    a.lastCareTick! + 600,
  );
  expect(
    garden(secondA, 'plant-a').lastCareTick! - a.lastCareTick!,
  ).toBeGreaterThanOrEqual(600);
  await play(page);
  await wait(page, 'due-b');
  const dueB = await capture(
    page,
    'finite-second-bed-genuine-due-wait',
    'plant-b',
  );
  conserved(dueB);
  expect(garden(dueB, 'plant-b').intervalTicks).toBe(600);
  expect(garden(dueB, 'plant-b').remainingTicks).toBeGreaterThan(0);
  await play(page);
  await wait(page, 'second-b');
  const secondB = await capture(
    page,
    'finite-four-actual-care-cycles',
    'plant-b',
  );
  conserved(secondB);
  expect(
    read(secondB).plants.map((g) => ('code' in g ? -1 : g.cycles)),
  ).toEqual([2, 2, 0]);
  await play(page);
  await wait(page, 'second-refill');
  const secondFill = await capture(
    page,
    'finite-second-and-final-real-resupply',
  );
  conserved(secondFill);
  expect({
    source: read(secondFill).source.contents!.fraction,
    bowl: read(secondFill).water.contents!.fraction,
  }).toEqual({ source: 0, bowl: 1 });
  await play(page);
  await wait(page, 'due-c');
  const dueC = await capture(
    page,
    'finite-third-bed-genuine-due-wait',
    'plant-c',
  );
  conserved(dueC);
  expect(garden(dueC, 'plant-c').remainingTicks).toBeGreaterThan(0);
  await play(page);
  await wait(page, 'completed');
  const final = await capture(
    page,
    'finite-six-care-cycles-supported-finite-remainder',
    'plant-c',
  );
  conserved(final);
  released(final);
  expect({
    circuit: read(final).circuit,
    index: read(final).index,
    source: read(final).source.contents!.fraction,
    bowl: read(final).water.contents!.fraction,
    support: read(final).water.support,
    finished: read(final).finished,
    care: read(final).plants.map((g) =>
      'code' in g
        ? g.code
        : {
            plant: g.plant,
            cycles: g.cycles,
            received: g.waterReceived,
            pending: g.pending,
          },
    ),
  }).toEqual({
    circuit,
    index: 6,
    source: 0,
    bowl: 0.5,
    support: { kind: 'resting-on', on: 'water-table', slot: 'r0c2' },
    finished: true,
    care: [
      { plant: 'plant-a', cycles: 2, received: 0.5, pending: undefined },
      { plant: 'plant-b', cycles: 2, received: 0.5, pending: undefined },
      { plant: 'plant-c', cycles: 2, received: 0.5, pending: undefined },
    ],
  });
  const fills = read(final).history.filter((r) => r?.verb === 'serve');
  expect(fills).toHaveLength(2);
  expect(
    fills.filter((r) => r!.history.some((h) => h.phase === 'back')),
  ).toHaveLength(2);
  expect(
    read(final).history.filter(
      (r) => r?.verb === 'garden_care' && r.status === 'completed',
    ),
  ).toHaveLength(6);
  expect({
    id: read(final).source.id,
    def: read(final).source.def,
    pose: read(final).source.pose,
    support: read(final).source.support,
    provenance: read(final).source.provenance,
  }).toEqual({
    id: initialSource.id,
    def: initialSource.def,
    pose: initialSource.pose,
    support: initialSource.support,
    provenance: initialSource.provenance,
  });
  expect({
    id: read(final).water.id,
    def: read(final).water.def,
    provenance: read(final).water.provenance,
  }).toEqual({
    id: initialWater.id,
    def: initialWater.def,
    provenance: initialWater.provenance,
  });
  expect(final.entities.map((e) => e.id).sort()).toEqual(ids);
  expect(consoleErrors).toEqual([]);
});
test('End before step, while holding committed refill and during actual due waiting retains water then Reset releases all state', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const consoleErrors = errors(page);
  await setup(page);
  await button(page, 'Start circuit').click();
  await button(page, 'End circuit').click();
  await play(page);
  await wait(page, 'ended');
  const before = await capture(page, 'end-reset-before-step-no-phantom-care');
  conserved(before);
  released(before);
  expect(read(before).history).toEqual([]);
  expect(read(before).source.contents!.fraction).toBe(0.5);
  expect(read(before).water.contents!.fraction).toBe(0);
  await button(page, 'Reset').click();
  await button(page, 'Step').click();
  expect((await inspect(page)).records).toEqual([]);
  await button(page, 'Start circuit').click();
  await play(page);
  await wait(page, 'refill');
  const held = await capture(page, 'end-reset-held-real-committed-water');
  conserved(held);
  expect(read(held).water.support).toEqual({
    kind: 'in-hand',
    by: 'carer',
    hand: 'right',
  });
  await button(page, 'End circuit').click();
  await play(page);
  await wait(page, 'ended');
  const endedHeld = await capture(page, 'end-reset-held-bowl-safely-supported');
  conserved(endedHeld);
  released(endedHeld);
  expect({
    water: read(endedHeld).water.contents,
    source: read(endedHeld).source.contents,
    cycles: read(endedHeld).plants.map((g) => ('code' in g ? -1 : g.cycles)),
    finished: read(endedHeld).finished,
    support: read(endedHeld).water.support,
  }).toEqual({
    water: read(held).water.contents,
    source: read(held).source.contents,
    cycles: [0, 0, 0],
    finished: false,
    support: { kind: 'resting-on', on: 'water-table', slot: 'r0c2' },
  });
  await expect(page.getByTestId('garden-circuit-state')).toContainText('ended');
  await button(page, 'Reset').click();
  await button(page, 'Step').click();
  await button(page, 'Start circuit').click();
  await play(page);
  await wait(page, 'refill');
  await wait(page, 'due-a');
  const due = await capture(
    page,
    'end-reset-genuine-supported-due-wait',
    'plant-a',
  );
  conserved(due);
  const retained = garden(due, 'plant-a');
  expect(retained.remainingTicks).toBeGreaterThan(0);
  const history = read(due).ownedActions,
    quantities = {
      water: read(due).water.contents,
      source: read(due).source.contents,
      care: read(due).plants.map((g) =>
        'code' in g
          ? g.code
          : {
              plant: g.plant,
              cycles: g.cycles,
              received: g.waterReceived,
              last: g.lastCareTick,
              pending: g.pending,
            },
      ),
    };
  await button(page, 'End circuit').click();
  await play(page);
  await wait(page, 'ended');
  const endedDue = await capture(
    page,
    'end-reset-due-clock-ended-not-completed',
    'plant-a',
  );
  conserved(endedDue);
  released(endedDue);
  expect({
    water: read(endedDue).water.contents,
    source: read(endedDue).source.contents,
    care: read(endedDue).plants.map((g) =>
      'code' in g
        ? g.code
        : {
            plant: g.plant,
            cycles: g.cycles,
            received: g.waterReceived,
            last: g.lastCareTick,
            pending: g.pending,
          },
    ),
  }).toEqual(quantities);
  expect(read(endedDue).ownedActions).toEqual(history);
  expect(read(endedDue).finished).toBe(false);
  expect(read(endedDue).index).toBe(1);
  await button(page, 'Reset').click();
  await button(page, 'Step').click();
  const reset = await capture(page, 'end-reset-fresh-finite-staging');
  expect({
    circuit: reset.circuit,
    records: reset.records,
    held: reset.held,
    slots: reset.slots.filter((s) => s.claimedBy !== null),
    violations: reset.violations,
  }).toEqual({
    circuit: null,
    records: [],
    held: [],
    slots: [],
    violations: [],
  });
  expect(reset.entities.map((e) => e.id).sort()).toEqual(
    due.entities.map((e) => e.id).sort(),
  );
  expect(consoleErrors).toEqual([]);
});
