/// <reference types="node" />
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
import type { libraryReadingReadout } from '../engine/activities/library-reading.ts';
declare global {
  interface Window {
    __marsEngine: EngineHook;
  }
}
type Reading = NonNullable<ReturnType<typeof libraryReadingReadout>>;
type LibraryHook = EngineHook & { libraryReading(): Reading | null };
const button = (p: Page, name: string) =>
  p.getByRole('button', { name, exact: true });
const read = (p: Page) =>
  p.evaluate(() => (window.__marsEngine as LibraryHook).libraryReading()!);
const artifacts = path.resolve(
  'e2e/artifacts',
  process.env.E2E_RUN ?? 'library-reading',
);
async function start(page: Page) {
  await page.goto('/lab?scenario=library-reading');
  await page.waitForFunction(() => window.__marsEngine?.ready);
  expect(await page.evaluate(() => window.__marsEngine.error)).toBe('');
  // Fresh initialization only; subsequent advancement is exclusively visible Play.
  await page.evaluate(() =>
    window.__marsEngine.runScenario('library-reading', {
      paused: true,
      speed: 4,
    }),
  );
  await expect(page.getByTestId('library-reading-hud')).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window.__marsEngine as LibraryHook).libraryReading(),
    ),
  ).toBeNull();
  const fixtures = await page.evaluate(() => window.__marsEngine.fixtures());
  await button(page, 'Start library reading').click();
  const initial = await read(page);
  expect(initial.params).toMatchObject({
    actor: 'reader',
    book: 'book',
    sourceSeat: 'chair-a#seat',
    destSeat: 'chair-b#seat',
    from: 'table-a#r0c0',
    to: 'table-b#r0c0',
    duration: 24,
    transferAfter: 7,
  });
  await button(page, 'Play').click();
  return { initial, fixtures };
}
async function partial(page: Page) {
  await page.waitForFunction(
    () => {
      const r = (window.__marsEngine as LibraryHook).libraryReading();
      return r?.stage === 'source-reading' && r.elapsed >= 2 && r.elapsed < 5;
    },
    undefined,
    { timeout: 60_000 },
  );
  await button(page, 'Pause').click();
  const r = await read(page);
  expect(r.elapsed).toBeLessThan(7);
  expect(
    await page.evaluate(
      () =>
        window.__marsEngine.slots().find((s) => s.id === 'chair-a#seat')
          ?.occupant,
    ),
  ).toBe('reader');
  expect(
    await page.evaluate(
      () =>
        window.__marsEngine.state().humans.find((h) => h.id === 'reader')
          ?.activity,
    ),
  ).toBe('sit');
  return r;
}
async function held(page: Page) {
  await page.waitForFunction(
    () => {
      const r = (window.__marsEngine as LibraryHook).libraryReading();
      return r?.stage === 'transfer' && r.support?.kind === 'in-hand';
    },
    undefined,
    { timeout: 60_000 },
  );
  await button(page, 'Pause').click();
  const r = await read(page);
  expect(r.support).toMatchObject({ kind: 'in-hand', by: 'reader' });
  expect(
    await page.evaluate(() =>
      window.__marsEngine.heldItems().map((i) => [i.id, i.by]),
    ),
  ).toEqual([['book', 'reader']]);
  return r;
}
async function stopAt(page: Page, mode: 'paused' | 'completed') {
  await page.waitForFunction(
    (m) => (window.__marsEngine as LibraryHook).libraryReading()?.mode === m,
    mode,
    { timeout: 90_000 },
  );
  await button(page, 'Pause').click();
  return read(page);
}
async function clean(page: Page, initial: Awaited<ReturnType<typeof start>>) {
  expect(
    await page.evaluate(() =>
      window.__marsEngine
        .records()
        .filter((r) => !['completed', 'cancelled'].includes(r.status)),
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(() =>
      window.__marsEngine
        .slots()
        .filter((s) => s.claimedBy !== null || s.occupant !== null),
    ),
  ).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.heldItems())).toEqual(
    [],
  );
  expect(
    await page.evaluate(() =>
      window.__marsEngine.state().humans.map((h) => [h.id, h.activity, h.task]),
    ),
  ).toEqual([
    ['reader', 'idle', null],
    ['visitor', 'idle', null],
  ]);
  expect(await page.evaluate(() => window.__marsEngine.fixtures())).toEqual(
    initial.fixtures,
  );
  expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual(
    [],
  );
  expect(
    await page.evaluate(() => window.__marsEngine.state().halted),
  ).toBeNull();
  const before = await page.evaluate(() => window.__marsEngine.state().tick);
  await button(page, 'Play').click();
  await page.waitForFunction(
    (t) => window.__marsEngine.state().tick > t + 20,
    before,
  );
  await button(page, 'Pause').click();
}
async function proof(
  page: Page,
  info: TestInfo,
  name: string,
  observations: unknown,
) {
  mkdirSync(artifacts, { recursive: true });
  const source = {
    head: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    trackedStatus: execFileSync(
      'git',
      ['status', '--porcelain', '--untracked-files=no'],
      { encoding: 'utf8' },
    ).trim(),
  };
  const final = await page.evaluate(() => {
    const h = window.__marsEngine as LibraryHook;
    return {
      library: h.libraryReading(),
      reading: h.reading(),
      state: h.state(),
      records: h.records(),
      slots: h.slots(),
      held: h.heldItems(),
      violations: h.violations(),
    };
  });
  const body = JSON.stringify(
    {
      source,
      method: 'actual visible UI Play; no stepping or pose/support edits',
      observations,
      final,
    },
    null,
    2,
  );
  writeFileSync(path.join(artifacts, `${name}.json`), body);
  await info.attach(name, { body, contentType: 'application/json' });
  await page.screenshot({ path: path.join(artifacts, `${name}.png`) });
}
test.describe('library reading actual Play', () => {
  test.setTimeout(180_000);
  test('library-reading: actual Play preserves the same book and bookmark through transfer to completion', async ({
    page,
  }, info) => {
    const initial = await start(page),
      source = await partial(page);
    expect(source.support).toMatchObject({
      kind: 'resting-on',
      on: 'table-a',
      slot: 'r0c0',
    });
    await proof(page, info, 'library-source-reading', { source });
    await button(page, 'Play').click();
    const transfer = await held(page);
    expect(transfer.elapsed).toBeGreaterThanOrEqual(7);
    expect(transfer.elapsed).toBeLessThan(8);
    expect(transfer.children[0]).toMatchObject({
      verb: 'read_book',
      status: 'cancelled',
    });
    await proof(page, info, 'library-held-transfer', { source, transfer });
    await button(page, 'Play').click();
    await page.waitForFunction(
      () => {
        const h = window.__marsEngine as LibraryHook,
          r = h.libraryReading(),
          b = h.reading();
        return (
          r?.stage === 'destination-reading' &&
          b &&
          !('code' in b) &&
          b.phase === 'arriving'
        );
      },
      undefined,
      { timeout: 60_000 },
    );
    await button(page, 'Pause').click();
    const destination = await read(page);
    expect(destination.elapsed).toBe(transfer.elapsed);
    expect(destination.support).toMatchObject({
      kind: 'resting-on',
      on: 'table-b',
      slot: 'r0c0',
    });
    const resumed = await page.evaluate(() =>
      window.__marsEngine
        .records()
        .reverse()
        .find((r) => r.verb === 'read_book'),
    );
    expect(resumed?.params).toMatchObject({
      actor: 'reader',
      book: 'book',
      seat: 'chair-b#seat',
      duration: 24,
      task: initial.initial.params.task,
      resume: true,
    });
    await proof(page, info, 'library-destination-bookmark', { transfer, destination, resumed });
    await button(page, 'Play').click();
    const final = await stopAt(page, 'completed');
    expect(final).toMatchObject({
      id: initial.initial.id,
      elapsed: 24,
      finished: true,
    });
    expect(final.children.map((c) => [c.verb, c.status])).toEqual([
      ['read_book', 'cancelled'],
      ['tidy_table_transfer', 'completed'],
      ['read_book', 'completed'],
    ]);
    expect(
      await page.evaluate(() => window.__marsEngine.reading()),
    ).toMatchObject({
      id: 'book',
      user: 'reader',
      status: 'completed',
      elapsed: 24,
      duration: 24,
      page: 4,
    });
    await clean(page, initial);
    await proof(page, info, 'library-full-play', {
      source,
      transfer,
      destination,
      final,
    });
  });
  test('library-reading: Pause and ordinary direction retain progress for explicit Resume', async ({
    page,
  }, info) => {
    const initial = await start(page);
    await partial(page);
    await button(page, 'Pause reading').click();
    await expect(button(page, 'Resume reading')).toBeDisabled();
    await button(page, 'Play').click();
    const paused = await stopAt(page, 'paused');
    await expect(button(page, 'Direct reader away')).toBeEnabled();
    await button(page, 'Direct reader away').click();
    const directive = await page.evaluate(() =>
      window.__marsEngine
        .records()
        .reverse()
        .find(
          (r) =>
            r.verb === 'walk_to' &&
            !r.parent &&
            (r.params as { actor?: string }).actor === 'reader',
        )!,
    );
    expect(directive.params).toMatchObject({ actor: 'reader', x: -3, z: -3 });
    await button(page, 'Play').click();
    await page.waitForFunction(
      (id) =>
        window.__marsEngine.records().find((r) => r.id === id)?.status ===
        'completed',
      directive.id,
      { timeout: 60_000 },
    );
    await button(page, 'Pause').click();
    const directed = await read(page);
    expect(directed.elapsed).toBe(paused.elapsed);
    expect(directed.mode).toBe('waiting');
    expect(directed.diagnostic?.code).toBe('library_reading.directed');
    expect(directed.children).toEqual(paused.children);
    expect(
      await page.evaluate(() => window.__marsEngine.reading()),
    ).toMatchObject({
      id: 'book',
      elapsed: paused.elapsed,
      status: 'unfinished',
    });
    await expect(button(page, 'Resume reading')).toBeEnabled();
    await button(page, 'Resume reading').click();
    await button(page, 'Play').click();
    const final = await stopAt(page, 'completed');
    expect(final).toMatchObject({
      id: initial.initial.id,
      elapsed: 24,
      finished: true,
    });
    await clean(page, initial);
    await proof(page, info, 'library-pause-direct-resume', {
      paused,
      directive,
      directed,
      final,
    });
  });
  test('library-reading: held transfer Pause and End drain safely before Reset', async ({
    page,
  }, info) => {
    const initial = await start(page),
      transfer = await held(page);
    await button(page, 'Pause reading').click();
    await button(page, 'Play').click();
    const paused = await stopAt(page, 'paused');
    expect(paused.elapsed).toBe(transfer.elapsed);
    expect(paused.support?.kind).toBe('resting-on');
    expect(await page.evaluate(() => window.__marsEngine.heldItems())).toEqual(
      [],
    );
    await expect(button(page, 'End reading')).toBeEnabled();
    await button(page, 'End reading').click();
    await button(page, 'Play').click();
    const ended = await stopAt(page, 'completed');
    expect(ended.finished).toBe(false);
    expect(ended.elapsed).toBe(paused.elapsed);
    expect(
      await page.evaluate(
        () =>
          window.__marsEngine
            .records()
            .find(
              (r) =>
                r.id ===
                (window.__marsEngine as LibraryHook).libraryReading()?.id,
            )?.status,
      ),
    ).toBe('cancelled');
    expect(
      await page.evaluate(() => window.__marsEngine.reading()),
    ).toMatchObject({
      id: 'book',
      status: 'unfinished',
      elapsed: paused.elapsed,
    });
    await clean(page, initial);
    await proof(page, info, 'library-held-pause-end', {
      transfer,
      paused,
      ended,
    });
    await button(page, 'Reset').click();
    expect(
      await page.evaluate(() =>
        (window.__marsEngine as LibraryHook).libraryReading(),
      ),
    ).toBeNull();
    expect(await page.evaluate(() => window.__marsEngine.records())).toEqual(
      [],
    );
    expect(
      await page.evaluate(() => window.__marsEngine.reading()),
    ).toMatchObject({ id: 'book', status: 'idle', elapsed: 0 });
    await expect(button(page, 'Start library reading')).toBeEnabled();
    await expect(button(page, 'Resume reading')).toBeDisabled();
    await button(page, 'Play').click();
    await page.waitForFunction(() => window.__marsEngine.state().tick > 20);
    await button(page, 'Pause').click();
    expect(
      await page.evaluate(() =>
        (window.__marsEngine as LibraryHook).libraryReading(),
      ),
    ).toBeNull();
    expect(await page.evaluate(() => window.__marsEngine.records())).toEqual(
      [],
    );
    expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual(
      [],
    );
    await proof(page, info, 'library-reset-epoch', { endedSession: ended.id });
    const second = await start(page),
      heldEnd = await held(page);
    await expect(button(page, 'End reading')).toBeEnabled();
    await button(page, 'End reading').click();
    await button(page, 'Play').click();
    const endedHeld = await stopAt(page, 'completed');
    expect(endedHeld.finished).toBe(false);
    expect(endedHeld.elapsed).toBe(heldEnd.elapsed);
    expect(endedHeld.support?.kind).toBe('resting-on');
    expect(
      await page.evaluate(() => window.__marsEngine.reading()),
    ).toMatchObject({
      id: 'book',
      status: 'unfinished',
      elapsed: heldEnd.elapsed,
    });
    await clean(page, second);
    await proof(page, info, 'library-held-end', { heldEnd, endedHeld });
  });
});
