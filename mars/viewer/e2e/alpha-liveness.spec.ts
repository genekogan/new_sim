import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
import type { Scenario } from '../app/lab/scenarios.ts';
import type { Runtime } from '../engine/runtime/runtime.ts';
import type { ActionRecord } from '../engine/actions/types.ts';
import type { Entity } from '../engine/world/types.ts';
import { collectConsoleErrors } from './helpers.ts';

type Mode = 'empty' | 'refusal' | 'reading-failure' | 'invariant';
type FixtureBridge = {
  submitVisitor: () => ActionRecord;
  declareValidReset: () => void;
  inspect: () => {
    generation: number;
    scriptTicks: number;
    book: Entity | null;
    claims: { resource: string; holders: string[] }[];
  };
};
type AlphaWindow = Omit<Window, '__marsEngine'> & {
  __marsEngine: EngineHook;
  __alphaLivenessFixture: FixtureBridge;
};
const source = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
const directory = path.resolve(
  'e2e/artifacts',
  process.env.E2E_RUN ?? 'alpha-liveness',
);
const errors = new WeakMap<Page, string[]>();
const button = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true });
async function inspect(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as AlphaWindow,
      h = w.__marsEngine;
    return {
      state: h.state(),
      fixture: w.__alphaLivenessFixture.inspect(),
      records: h.records() as ActionRecord[],
      log: h.log(),
      violations: h.violations(),
      held: h.heldItems(),
      fields: h.humanFields(),
      slots: h.slots(),
      components: h.components(),
      reading: h.reading(),
      hash: h.stateHash(),
    };
  });
}
async function frameWindow(page: Page) {
  const from = await page.evaluate(
    () => (window as unknown as AlphaWindow).__marsEngine.frames,
  );
  await page.waitForFunction(
    (n) => (window as unknown as AlphaWindow).__marsEngine.frames >= n + 4,
    from,
    { timeout: 15_000 },
  );
}
async function pause(page: Page) {
  const s = await page.evaluate(() =>
    (window as unknown as AlphaWindow).__marsEngine.state(),
  );
  if (!s.paused && !s.halted) await button(page, 'Pause').click();
}
async function play(page: Page) {
  await expect(button(page, 'Play')).toBeEnabled();
  await button(page, 'Play').click();
}
async function capture(page: Page, name: string) {
  await pause(page);
  const evidence = await inspect(page);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, `${name}.json`),
    JSON.stringify(
      {
        source,
        run: process.env.E2E_RUN,
        scope:
          'test-fixture Lab driver failure isolation; not production-preset recovery',
        evidence,
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: path.join(directory, `${name}.png`) });
  writeFileSync(
    path.join(directory, `${name}.a11y.yml`),
    await page.locator('body').ariaSnapshot(),
  );
  return evidence;
}
async function open(page: Page, mode: Mode) {
  errors.set(page, collectConsoleErrors(page));
  await page.goto('/lab?scenario=body');
  await page.waitForFunction(
    () => (window as unknown as AlphaWindow).__marsEngine?.ready,
    null,
    { timeout: 15_000 },
  );
  await page.evaluate(async (mode) => {
    // Test-only authored declarations. No authoritative pose/support writes or extra driver.
    const urls = {
      scenarios: '/app/lab/scenarios.ts',
      reading: '/engine/scenarios/reading.ts',
      runtime: '/engine/runtime/runtime.ts',
      factory: '/engine/world/factory.ts',
      spatial: '/engine/spatial/service.ts',
      invariants: '/engine/runtime/invariants.ts',
      walk: '/engine/locomotion/walk.ts',
    };
    const { SCENARIOS } = (await import(
      urls.scenarios
    )) as typeof import('../app/lab/scenarios.ts');
    const reading = (await import(
      urls.reading
    )) as typeof import('../engine/scenarios/reading.ts');
    const { Runtime } = (await import(
      urls.runtime
    )) as typeof import('../engine/runtime/runtime.ts');
    const { emptyWorld, addAll, human } = (await import(
      urls.factory
    )) as typeof import('../engine/world/factory.ts');
    const { Spatial } = (await import(
      urls.spatial
    )) as typeof import('../engine/spatial/service.ts');
    const { DEFAULT_INVARIANTS } = (await import(
      urls.invariants
    )) as typeof import('../engine/runtime/invariants.ts');
    const { walkTo } = (await import(
      urls.walk
    )) as typeof import('../engine/locomotion/walk.ts');
    let rt: Runtime,
      generation = 0,
      scriptTicks = 0,
      invalidFixture = mode === 'invariant';
    const scenario: Scenario = {
      name: `alpha-liveness-${mode}`,
      title: `Hypothetical driver proof · ${mode}`,
      description:
        'Test-only anonymous setup for Lab failure isolation. Ordinary registered actions own all movement; invalid initial overlap is fault injection, not production activity.',
      scene: () => reading.READING_SCENE,
      humans: () => [],
      build: () => {
        generation++;
        scriptTicks = 0;
        rt =
          mode === 'invariant'
            ? new Runtime(
                addAll(
                  emptyWorld(
                    'alpha-invalid-initial-fixture',
                    reading.READING_SCENE,
                  ),
                  human('reader', -4, -4),
                  human('visitor', -4, invalidFixture ? -4 : 4),
                ),
                new Map([['walk_to', walkTo]]),
                { spatial: new Spatial(reading.READING_SCENE) },
                DEFAULT_INVARIANTS,
              )
            : reading.readingRuntime();
        return rt;
      },
      start: (rt) => {
        if (mode === 'refusal')
          rt.submit('walk_to', { actor: 'missing-reader', x: 2, z: 2 });
        if (mode === 'reading-failure') {
          rt.submit('read_book', reading.READING_BINDING);
          rt.submit('walk_to', { actor: 'visitor', x: 7, z: -7 });
        }
      },
      tick: () => {
        scriptTicks++;
      },
      continuous: mode === 'invariant',
      done:
        mode === 'reading-failure'
          ? (rt) =>
              [...rt.records.values()].some(
                (r) =>
                  r.verb === 'read_book' &&
                  ['failed', 'cancelled', 'completed'].includes(r.status),
              )
          : undefined,
      expectedFailure:
        mode === 'refusal'
          ? (rt, id) =>
              (rt.records.get(id)?.params as { actor?: string })?.actor ===
              'missing-reader'
          : undefined,
      maxTicks: mode === 'invariant' ? 20 : 1000,
      focus: [0, 0, 8, 65],
      expect: (rt) => [
        {
          ok: !rt.violations.length,
          message: 'zero authoritative invariant violations',
        },
        ...(mode === 'reading-failure'
          ? [
              {
                ok: [...rt.records.values()].some(
                  (r) => r.verb === 'read_book' && r.status === 'completed',
                ),
                message:
                  'assigned reading completed; seat-release failure remains an unfinished outcome',
              },
            ]
          : []),
      ],
    };
    SCENARIOS.push(scenario);
    (window as unknown as AlphaWindow).__alphaLivenessFixture = {
      // Fixed ordinary command through real admission; unavailable in product hooks.
      submitVisitor: () =>
        structuredClone(
          rt.submit('walk_to', { actor: 'visitor', x: 7, z: -7 }),
        ),
      // Changes only the next pre-Runtime fixture declaration; never repairs a live world.
      declareValidReset: () => {
        invalidFixture = false;
      },
      inspect: () => ({
        generation,
        scriptTicks,
        book: rt.world.entities.book
          ? structuredClone(rt.world.entities.book)
          : null,
        claims: [
          'actor:reader',
          'actor:visitor',
          'hand:reader:left',
          'hand:reader:right',
          'reading:book',
          'entity:book',
          'entity:reading-table',
          'entity:reading-chair',
          'slot:reading-chair#seat',
        ].map((resource) => ({ resource, holders: [...rt.holder(resource)] })),
      }),
    };
    await (window as unknown as AlphaWindow).__marsEngine.runScenario(
      scenario.name,
      {
        paused: true,
        speed: 2,
      },
    );
  }, mode);
  const initial = await inspect(page);
  expect(initial.state.tick).toBe(0);
  expect(initial.state.paused).toBe(true);
  expect(initial.violations).toEqual([]);
  expect(initial.state.halted).toBeNull();
  return initial;
}
function released(evidence: Awaited<ReturnType<typeof inspect>>) {
  expect(evidence.held).toEqual([]);
  expect(evidence.fixture.claims.filter((q) => q.holders.length)).toEqual([]);
  expect(
    evidence.records.filter(
      (r) => !['failed', 'cancelled', 'completed'].includes(r.status),
    ),
  ).toEqual([]);
  expect(evidence.violations).toEqual([]);
}
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus)
    await capture(page, `failure-${info.title.replace(/[^a-z0-9]+/gi, '-')}`);
  expect(errors.get(page) ?? []).toEqual([]);
});

for (const mode of ['empty', 'refusal'] as const) {
  test(`alpha actual Play: ${mode} terminal script retains a usable world and independent ordinary walk`, async ({
    page,
  }) => {
    const initial = await open(page, mode);
    expect(initial.state.done).toBe(true);
    expect(initial.state.scriptStopReason).toBe('terminal');
    if (mode === 'refusal') {
      expect(initial.records).toHaveLength(1);
      expect(initial.records[0]).toMatchObject({
        status: 'failed',
        diagnostic: { code: 'entity.unknown', subjects: ['missing-reader'] },
      });
      await expect(page.getByRole('alert')).toContainText('EXPECTED CONFLICT');
    }
    await play(page);
    await expect
      .poll(async () => (await inspect(page)).state.tick)
      .toBeGreaterThanOrEqual(5);
    const liveClock = await capture(page, `${mode}-terminal-clock`);
    expect(liveClock.fixture.scriptTicks).toBe(0);
    expect(liveClock.state.done).toBe(true);
    const command = await page.evaluate(() =>
      (window as unknown as AlphaWindow).__alphaLivenessFixture.submitVisitor(),
    );
    expect(command.status).toBe('executing');
    await play(page);
    await expect
      .poll(async () => (await inspect(page)).state.tick)
      .toBeGreaterThan(liveClock.state.tick + 2);
    const moving = await capture(page, `${mode}-independent-moving`);
    expect(moving.records.find((r) => r.id === command.id)?.status).toBe(
      'executing',
    );
    expect(moving.state.humans.find((h) => h.id === 'visitor')?.p).not.toEqual(
      initial.state.humans.find((h) => h.id === 'visitor')?.p,
    );
    expect(moving.state.scriptStopReason).toBe('terminal');
    expect(moving.state.done).toBe(true);
    expect(moving.fixture.scriptTicks).toBe(0);
    await frameWindow(page);
    expect((await inspect(page)).hash).toBe(moving.hash); // actual UI Pause freezes all authoritative effects
    await button(page, 'Step').click();
    expect((await inspect(page)).state.tick).toBe(moving.state.tick + 1);
    expect((await inspect(page)).state.paused).toBe(true);
    await play(page);
    await expect
      .poll(
        async () =>
          (await inspect(page)).records.find((r) => r.id === command.id)
            ?.status,
      )
      .toBe('completed');
    const end = await capture(page, `${mode}-independent-completed`);
    expect(end.fixture.scriptTicks).toBe(0);
    released(end);
    expect(end.state.humans.find((h) => h.id === 'visitor')?.p).toEqual([
      7, 0, -7,
    ]);
    expect(end.records.filter((r) => r.status === 'failed')).toEqual(
      initial.records,
    );
    await button(page, 'Reset').click();
    const reset = await capture(page, `${mode}-fresh-reset`);
    expect(reset.state.tick).toBe(0);
    expect(reset.fixture.generation).toBe(end.fixture.generation + 1);
    expect(reset.state.humans).toEqual(initial.state.humans);
    expect(reset.records).toEqual(initial.records);
    released(reset);
  });
}

test('alpha actual Play: real reading child failure keeps explanation, cleanup and unrelated movement', async ({
  page,
}) => {
  const initial = await open(page, 'reading-failure');
  const bookBefore = initial.components.find((c) => c.id === 'book')!;
  await play(page);
  await expect
    .poll(async () => {
      const state = (await inspect(page)).reading;
      return 'code' in state ? 0 : state.elapsed;
    })
    .toBeGreaterThanOrEqual(1);
  const reading = await capture(page, 'reading-before-seat-intervention');
  const seat = reading.records.find(
    (r) => r.verb === 'sit' && r.phase === 'occupied',
  )!;
  expect(seat).toBeDefined();
  const readingID = reading.records.find((r) => r.verb === 'read_book')!.id;
  const visitorID = reading.records.find(
    (r) =>
      r.verb === 'walk_to' &&
      (r.params as { actor?: string }).actor === 'visitor',
  )!.id;
  expect(reading.records.find((r) => r.id === visitorID)?.status).toBe(
    'executing',
  );
  await page.evaluate(
    (id) => (window as unknown as AlphaWindow).__marsEngine.cancelAction(id),
    seat.id,
  );
  await play(page);
  await expect
    .poll(
      async () =>
        (await inspect(page)).records.find((r) => r.id === readingID)?.status,
    )
    .toBe('failed');
  await expect(page.getByRole('alert')).toContainText('reading.seat-released');
  const failed = await capture(page, 'reading-failed-world-usable');
  expect(failed.state.halted).toBeNull();
  expect(failed.state.scriptStopReason).toBe('terminal');
  expect(failed.records.find((r) => r.id === readingID)?.diagnostic?.code).toBe(
    'reading.seat-released',
  );
  expect(
    failed.state.checks.some(
      (c) => !c.ok && c.message.includes('unfinished outcome'),
    ),
  ).toBe(true);
  expect(failed.state.humans.find((h) => h.id === 'reader')?.activity).toBe(
    'idle',
  );
  expect(
    failed.fixture.claims.filter(
      (q) => q.resource !== 'actor:visitor' && q.holders.length,
    ),
  ).toEqual([]);
  expect(failed.slots.find((s) => s.id === 'reading-chair#seat')?.state).toBe(
    'free',
  );
  if ('code' in failed.reading) throw Error(failed.reading.message);
  expect(failed.reading.status).toBe('unfinished');
  expect(failed.reading.elapsed).toBeGreaterThanOrEqual(1);
  expect(failed.reading.elapsed).toBeLessThan(24);
  const bookmark = failed.reading.elapsed,
    scriptTicks = failed.fixture.scriptTicks;
  await play(page);
  await expect
    .poll(async () => (await inspect(page)).state.tick)
    .toBeGreaterThan(failed.state.tick + 3);
  await expect
    .poll(
      async () =>
        (await inspect(page)).records.find((r) => r.id === visitorID)?.status,
    )
    .toBe('completed');
  const end = await capture(page, 'reading-failure-other-walker-completed');
  expect(end.fixture.scriptTicks).toBe(scriptTicks);
  expect(end.fixture.book?.id).toBe(initial.fixture.book?.id);
  expect(end.fixture.book?.def).toBe(initial.fixture.book?.def);
  expect(end.fixture.book?.support).toEqual(initial.fixture.book?.support);
  expect(end.fixture.book?.pose).toEqual(initial.fixture.book?.pose);
  expect(end.components.find((c) => c.id === 'book')?.pose).toEqual(
    bookBefore.pose,
  );
  expect(end.components.find((c) => c.id === 'book')?.support).toBe(
    bookBefore.support,
  );
  if ('code' in end.reading) throw Error(end.reading.message);
  expect(end.reading.elapsed).toBe(bookmark);
  expect(end.log.some((l) => l.text.includes('reading.seat-released'))).toBe(
    true,
  );
  released(end);
});

test('alpha actual Play: genuine invalid fixture visibly halts, then explicit fresh valid Reset restores clock', async ({
  page,
}) => {
  await open(page, 'invariant');
  await play(page);
  await expect
    .poll(async () => (await inspect(page)).state.halted?.code)
    .toBe('lab.invariant-halt');
  const halt = await capture(page, 'invariant-visible-halt');
  expect(halt.violations.length).toBeGreaterThan(0);
  expect(halt.fixture.scriptTicks).toBe(0);
  await expect(
    page.getByRole('alert').filter({ hasText: 'lab.invariant-halt' }),
  ).toContainText('reset to a fresh world');
  await expect(button(page, 'Pause')).toBeDisabled();
  await expect(button(page, 'Step')).toBeDisabled();
  await expect(button(page, 'Reset')).toBeEnabled();
  await frameWindow(page);
  expect((await inspect(page)).hash).toBe(halt.hash);
  // Existing read-only hook output must not alias the halt or original violation receipts.
  await page.evaluate(() => {
    const copy = (window as unknown as AlphaWindow).__marsEngine.state();
    copy.halted!.message = 'detached mutation';
    copy.halted!.subjects?.push('detached');
  });
  expect((await inspect(page)).state.halted).toEqual(halt.state.halted);
  expect((await inspect(page)).violations).toEqual(halt.violations);
  await page.evaluate(() => {
    const w = window as unknown as AlphaWindow;
    w.__alphaLivenessFixture.declareValidReset(); // explicit next fixture declaration, no live repair
    w.__marsEngine.pause(true); // keep the fresh reset inspectable at tick0
  });
  await button(page, 'Reset').click();
  const reset = await capture(page, 'invariant-fresh-valid-reset');
  expect(reset.fixture.generation).toBe(halt.fixture.generation + 1);
  expect(reset.state.tick).toBe(0);
  expect(reset.state.paused).toBe(true);
  expect(reset.state.halted).toBeNull();
  expect(reset.violations).toEqual([]);
  expect(reset.records).toEqual([]);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await button(page, 'Step').click();
  expect((await inspect(page)).state.tick).toBe(1);
  await play(page);
  await expect
    .poll(async () => (await inspect(page)).state.tick)
    .toBeGreaterThanOrEqual(30);
  const usable = await capture(
    page,
    'invariant-reset-world-past-script-budget',
  );
  expect(usable.state.scriptStopReason).toBe('budget');
  expect(usable.state.humans).toEqual(reset.state.humans);
  released(usable);
});
