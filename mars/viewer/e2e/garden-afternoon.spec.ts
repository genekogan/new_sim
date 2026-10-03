/// <reference types="node" />
import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
import type { readGardenAfternoon } from '../engine/scenarios/garden-afternoon.ts';
declare global {
  interface Window {
    __marsEngine: EngineHook;
  }
}
type GardenHook = EngineHook & {
  gardenAfternoon: () => ReturnType<typeof readGardenAfternoon> | null;
};
const source = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
  directory = path.resolve(
    'e2e/artifacts',
    process.env.E2E_RUN ?? `garden-afternoon-${source.slice(0, 7)}`,
  );
const button = (p: Page, name: string) =>
  p.getByRole('button', { name, exact: true });
async function inspect(page: Page) {
  return page.evaluate(() => {
    const h = window.__marsEngine as GardenHook;
    return {
      afternoon: h.gardenAfternoon(),
      state: h.state(),
      records: h.records(),
      held: h.heldItems(),
      slots: h.slots(),
      violations: h.violations(),
      hands: h.humanFields(),
      bones: h.bones(),
      markers: h.seedMarkers(),
      entities: h.cameraEntities(),
    };
  });
}
async function play(p: Page) {
  if (await p.evaluate(() => window.__marsEngine.state().paused))
    await button(p, 'Play').click();
}
async function freeze(p: Page) {
  if (!(await p.evaluate(() => window.__marsEngine.state().paused)))
    await button(p, 'Pause').click();
}
function read(s: Awaited<ReturnType<typeof inspect>>) {
  const a = s.afternoon;
  if (!a || 'code' in a.seedbed || 'code' in a.book || 'code' in a.garden)
    throw Error('Missing authoritative afternoon/material readout');
  return { ...a, seedbed: a.seedbed, book: a.book, garden: a.garden };
}
function conserved(s: Awaited<ReturnType<typeof inspect>>) {
  const a = read(s);
  expect({
    seedFood: a.seeds.contents?.food,
    seedTotal: a.seeds.contents!.fraction + a.seedbed.deposited,
    waterFood: a.water.contents?.food,
    waterTotal: a.water.contents!.fraction + a.garden.waterReceived,
    book: a.book.id,
    violations: s.violations,
  }).toEqual({
    seedFood: 'seeds',
    seedTotal: 0.5,
    waterFood: 'water',
    waterTotal: 0.5,
    book: 'book',
    violations: [],
  });
}
async function capture(page: Page, name: string) {
  await freeze(page);
  const s = await inspect(page);
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${name}.png`) });
  writeFileSync(
    path.join(directory, `${name}.a11y.yml`),
    await page.locator('body').ariaSnapshot(),
  );
  writeFileSync(
    path.join(directory, `${name}.json`),
    JSON.stringify({ source, run: process.env.E2E_RUN, data: s }, null, 2),
  );
  return s;
}
async function wait(
  page: Page,
  condition:
    | 'partial'
    | 'paused'
    | 'reader-return'
    | 'seed-return'
    | 'water-deposit'
    | 'completed',
  before = 0,
) {
  await page.waitForFunction(
    ({ condition, before }) => {
      const a = (window.__marsEngine as GardenHook).gardenAfternoon();
      if (!a || 'code' in a.seedbed || 'code' in a.book) return false;
      if (condition === 'partial')
        return (
          a.branches.gardener.planting?.phase === 'sowing' &&
          a.seedbed.deposits >= 1 &&
          a.seedbed.deposits <= 2
        );
      if (condition === 'paused')
        return (
          a.branches.gardener.intention?.mode === 'paused' &&
          a.seeds.support?.kind === 'resting-on' &&
          a.book.elapsed > before
        );
      if (condition === 'reader-return')
        return (
          a.branches.reader.intention?.index === 2 &&
          a.book.status === 'active' &&
          a.book.elapsed > 4 &&
          a.book.elapsed < 24
        );
      if (condition === 'seed-return')
        return (
          a.seedbed.completed &&
          a.seeds.support?.kind === 'resting-on' &&
          a.seeds.support.on === 'seed-table' &&
          a.seeds.support.slot === 'r0c2'
        );
      if (condition === 'water-deposit')
        return (
          !('code' in a.garden) &&
          a.garden.waterReceived > 0 &&
          a.garden.waterReceived < 0.25 &&
          a.water.support?.kind === 'in-hand' &&
          a.water.support.by === 'planter' &&
          a.water.support.hand === 'right' &&
          window.__marsEngine
            .records()
            .some(
              (r) =>
                r.verb === 'garden_care' &&
                r.parent === a.gardener &&
                r.phase === 'watering',
            )
        );
      return a.phase === 'completed';
    },
    { condition, before },
    { timeout: 15_000 },
  );
}
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) {
    await capture(
      page,
      `${info.title.startsWith('rotated') ? 'garden-afternoon-rotated' : 'garden-afternoon'}-failure`,
    );
  }
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(
      directory,
      `${info.title.startsWith('rotated') ? 'rotated' : 'default'}-result.json`,
    ),
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
for (const rotated of [false, true])
  test(`${rotated ? 'rotated' : 'default'} actual Play garden and same-book afternoon`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const name = rotated ? 'garden-afternoon-rotated' : 'garden-afternoon',
      errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (e) => {
      if (e.type() === 'error') errors.push(e.text());
    });
    await page.goto(`/lab?scenario=${name}`);
    await page.waitForFunction(() => window.__marsEngine?.ready);
    await page.evaluate(
      (name) =>
        window.__marsEngine.runScenario(name, { paused: true, speed: 2 }),
      name,
    );
    await button(page, 'Reset').click();
    await button(page, 'Step').click(); // readiness tick only; all journeys below use actual Play.
    expect((await inspect(page)).records).toEqual([]);
    await expect(page.getByTestId('garden-afternoon-hud')).toContainText(
      'Hypothetical anonymous',
    );
    await button(page, 'Start garden afternoon').click();
    await play(page);
    await wait(page, 'partial');
    await page.evaluate(() => {
      const a = (window.__marsEngine as GardenHook).gardenAfternoon();
      if (a && !('code' in a.seedbed)) {
        const t = a.seedbed.target;
        window.__marsEngine.camera([t[0] + 3, t[1] + 2.4, t[2] - 4], t);
      }
    });
    const partial = await capture(
        page,
        `${name}-partial-actual-seeds-and-reader`,
      ),
      a = read(partial);
    conserved(partial);
    expect(a.seeds.support).toEqual({
      kind: 'in-hand',
      by: 'planter',
      hand: 'right',
    });
    expect(partial.hands.planter.hands?.right).toEqual(
      a.branches.gardener.planting?.hand,
    );
    expect(partial.bones.planter.activity).toBe('reach');
    expect(partial.markers.find((m) => m.plant === 'planter-a')?.count).toBe(
      a.seedbed.deposits,
    );
    if (rotated) await button(page, 'Direct gardener away').click();
    else await button(page, 'Pause gardener').click();
    await play(page);
    await wait(page, 'paused', a.book.elapsed);
    if (rotated)
      await page.waitForFunction(
        () =>
          window.__marsEngine
            .records()
            .some(
              (r) =>
                r.verb === 'walk_to' &&
                !r.parent &&
                (r.params as { actor?: string }).actor === 'planter' &&
                r.status === 'completed',
            ),
        undefined,
        { timeout: 15_000 },
      );
    const paused = await capture(
        page,
        `${name}-safe-return-independent-reader`,
      ),
      b = read(paused);
    conserved(paused);
    expect({
      purpose: b.seedbed.purpose,
      deposited: b.seedbed.deposited,
      support: b.seeds.support,
    }).toEqual({
      purpose: a.seedbed.purpose,
      deposited: a.seedbed.deposited,
      support: { kind: 'resting-on', on: 'seed-table', slot: 'r0c2' },
    });
    expect(b.book.elapsed).toBeGreaterThan(a.book.elapsed);
    await button(page, 'Resume gardener').click();
    await play(page);
    await wait(page, 'reader-return');
    await page.evaluate(() => {
      const b = (window.__marsEngine as GardenHook).gardenAfternoon()
        ?.bookEntity;
      if (b) {
        const t = b.pose.p;
        window.__marsEngine.camera([t[0] + 3, t[1] + 2, t[2] - 4], t);
      }
    });
    const returning = await capture(
        page,
        `${name}-same-unfinished-book-return`,
      ),
      r = read(returning);
    conserved(returning);
    expect(r.book).toMatchObject({
      id: 'book',
      task: 'Hypothetical garden reading',
      duration: 24,
      status: 'active',
    });
    expect(
      returning.records
        .filter((c) => c.verb === 'read_book')
        .map((c) => (c.params as { book: string }).book),
    ).toEqual(['book', 'book']);
    await button(page, 'Pause reader').click();
    await play(page);
    await page.waitForFunction(
      () =>
        (window.__marsEngine as GardenHook).gardenAfternoon()?.branches.reader
          .intention?.mode === 'paused',
      undefined,
      { timeout: 15_000 },
    );
    const readerPaused = await capture(page, `${name}-reader-local-pause`),
      bookmark = read(readerPaused).book.elapsed;
    await button(page, 'Resume reader').click();
    await play(page);
    // These are separate serial physical obligations. Each retains the original
    // 15-second phase deadline; final completion still needs supported return.
    await wait(page, 'seed-return');
    await page.evaluate(() => {
      const table = window.__marsEngine
        .cameraEntities()
        .find((e) => e.id === 'seed-table');
      if (table) {
        const t: [number, number, number] = [
          table.pose.p[0],
          table.pose.p[1] + 0.8,
          table.pose.p[2],
        ];
        window.__marsEngine.camera([t[0] + 3, t[1] + 2.4, t[2] - 4], t);
      }
    });
    const seedReturned = await capture(
        page,
        `${name}-completed-seeds-supported-return`,
      ),
      seedEffect = read(seedReturned);
    conserved(seedReturned);
    expect({
      purpose: seedEffect.seedbed.purpose,
      source: seedEffect.seedbed.source,
      deposited: seedEffect.seedbed.deposited,
      completed: seedEffect.seedbed.completed,
      bowl: seedEffect.seeds.id,
      remainder: seedEffect.seeds.contents?.fraction,
      support: seedEffect.seeds.support,
    }).toEqual({
      purpose: a.seedbed.purpose,
      source: 'seed-bowl',
      deposited: 0.25,
      completed: true,
      bowl: 'seed-bowl',
      remainder: 0.25,
      support: { kind: 'resting-on', on: 'seed-table', slot: 'r0c2' },
    });
    await play(page);
    await wait(page, 'water-deposit');
    await page.evaluate(() => {
      const a = (window.__marsEngine as GardenHook).gardenAfternoon();
      if (a && !('code' in a.garden)) {
        const t = a.garden.target;
        window.__marsEngine.camera([t[0] + 3, t[1] + 2.4, t[2] - 4], t);
      }
    });
    const watering = await capture(page, `${name}-actual-finite-water-deposit`),
      care = read(watering);
    conserved(watering);
    expect({
      purpose: care.seedbed.purpose,
      planted: care.seedbed.deposited,
      bowl: care.water.id,
      support: care.water.support,
      material: care.water.contents?.food,
      received: care.garden.waterReceived,
      remainder: care.water.contents?.fraction,
      cycles: care.garden.cycles,
      plant: care.garden.plant,
      pendingSource: care.garden.pending?.water,
      bones: watering.bones.planter.activity,
    }).toEqual({
      purpose: a.seedbed.purpose,
      planted: 0.25,
      bowl: 'water-bowl',
      support: { kind: 'in-hand', by: 'planter', hand: 'right' },
      material: 'water',
      received: care.garden.pending!.delivered,
      remainder: 0.5 - care.garden.pending!.delivered,
      cycles: 0,
      plant: 'planter-a',
      pendingSource: 'water-bowl',
      bones: 'reach',
    });
    expect(care.garden.waterReceived).toBeGreaterThan(0);
    expect(care.garden.waterReceived).toBeLessThan(0.25);
    await play(page);
    await wait(page, 'completed');
    const final = await capture(page, `${name}-completed-finite-care-and-book`),
      f = read(final);
    conserved(final);
    expect({
      seedPurpose: f.seedbed.purpose,
      seeds: f.seedbed.deposited,
      water: f.garden.waterReceived,
      book: f.book.elapsed,
      bookIdentity: f.bookEntity.id,
      bookSupport: f.bookEntity.support,
      status: f.book.status,
    }).toEqual({
      seedPurpose: a.seedbed.purpose,
      seeds: 0.25,
      water: 0.25,
      book: 24,
      bookIdentity: 'book',
      bookSupport: { kind: 'resting-on', on: 'reading-table', slot: 'r0c2' },
      status: 'completed',
    });
    expect(bookmark).toBeLessThan(24);
    expect({
      held: final.held,
      claimed: final.slots.filter((s) => s.claimedBy !== null),
      active: final.records.filter(
        (c) => !['completed', 'cancelled'].includes(c.status),
      ),
      entities: final.entities.map((e) => e.id).sort(),
    }).toEqual({
      held: [],
      claimed: [],
      active: [],
      entities: partial.entities.map((e) => e.id).sort(),
    });
    // End on a fresh accepted binding before its first step must create no phantom purpose/children.
    await button(page, 'Reset').click();
    await button(page, 'Step').click();
    await button(page, 'Start garden afternoon').click();
    await button(page, 'End gardener').click();
    await button(page, 'End reader').click();
    await play(page);
    await page.waitForFunction(
      () =>
        (window.__marsEngine as GardenHook).gardenAfternoon()?.phase ===
        'ended',
      undefined,
      { timeout: 15_000 },
    );
    await expect(page.getByTestId('garden-afternoon-gardener')).toContainText(
      '· ended ·',
    );
    await expect(page.getByTestId('garden-afternoon-reader')).toContainText(
      '· ended ·',
    );
    const ended = await capture(page, `${name}-end-before-first-step`);
    expect({
      purpose: read(ended).seedbed.purpose,
      deposited: read(ended).seedbed.deposited,
      leaves: ended.records.filter((c) =>
        ['seed_planting', 'read_book', 'garden_care'].includes(c.verb),
      ),
      held: ended.held,
      violations: ended.violations,
    }).toEqual({
      purpose: undefined,
      deposited: 0,
      leaves: [],
      held: [],
      violations: [],
    });
    await button(page, 'Reset').click();
    const reset = await capture(page, `${name}-reset-clean`);
    expect({
      afternoon: reset.afternoon,
      records: reset.records,
      held: reset.held,
      violations: reset.violations,
      errors,
    }).toEqual({
      afternoon: null,
      records: [],
      held: [],
      violations: [],
      errors: [],
    });
  });
