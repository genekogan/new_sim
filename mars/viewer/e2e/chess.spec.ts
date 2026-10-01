/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
declare global {
  interface Window {
    __marsEngine: EngineHook;
  }
}
const artifacts = path.resolve('e2e/artifacts', process.env.E2E_RUN ?? 'chess');
test('physical tabletop chess: fresh Step, four actual Play turns, checkmate and same-token reset', async ({
  page,
}) => {
  mkdirSync(artifacts, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/lab?scenario=tabletop-chess');
  await page.waitForFunction(() => window.__marsEngine?.ready);
  await page.evaluate(() =>
    window.__marsEngine.runScenario('tabletop-chess', { paused: true }),
  );
  const button = (name: string) =>
    page.getByRole('button', { name, exact: true });
  await button('Reset').click();
  await button('Step').click();
  expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual(
    [],
  );
  const original = await page.evaluate(() => window.__marsEngine.chessTokens());
  expect(original).toHaveLength(32);
  await page.evaluate(() =>
    window.__marsEngine.camera([1.8, 1.9, -2.5], [-0.15, 0.8, 0]),
  );
  for (let ply = 0; ply < 4; ply++) {
    await button('Play proposed move').click();
    await button('Play').click();
    if (ply === 0) {
      await page.waitForFunction(() =>
        window.__marsEngine.heldItems().some((x) => x.id === 'white-pawn-f2'),
      );
      await button('Pause').click();
      const held = await page.evaluate(() =>
        window.__marsEngine.heldItems().find((x) => x.id === 'white-pawn-f2'),
      );
      expect(held).toMatchObject({
        def: 'chess-white-pawn',
        by: 'white-player',
        hand: 'right',
      });
      const game = await page.evaluate(() => window.__marsEngine.chess());
      expect(game).toMatchObject({ position: { ply: 0 }, pending: true });
      await page.screenshot({
        path: path.join(artifacts, 'chess-same-pawn-in-hand.png'),
      });
      await button('Play').click();
    }
    await page.waitForFunction((wanted) => {
      const s = window.__marsEngine.chess();
      return !('code' in s) && s.position.ply === wanted && !s.pending;
    }, ply + 1);
    await button('Pause').click();
    expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual(
      [],
    );
    if (ply === 1)
      await page.screenshot({
        path: path.join(artifacts, 'chess-two-completed-turns.png'),
      });
  }
  await expect(page.getByTestId('chess-readout')).toContainText('checkmate');
  const final = await page.evaluate(() => window.__marsEngine.chessTokens());
  expect(final.map((x) => ({ id: x.id, def: x.def }))).toEqual(
    original.map((x) => ({ id: x.id, def: x.def })),
  );
  expect(final.find((x) => x.id === 'black-queen-d8')?.support).toEqual({
    kind: 'resting-on',
    on: 'board',
    slot: 'h4',
  });
  expect(await page.evaluate(() => window.__marsEngine.heldItems())).toEqual(
    [],
  );
  await page.screenshot({
    path: path.join(artifacts, 'chess-checkmate-supported-tokens.png'),
  });
  const baseline = await page.evaluate(() => window.__marsEngine.info());
  const resets = [];
  for (let i = 0; i < 3; i++) {
    const frame = await page.evaluate(() => window.__marsEngine.info().frames);
    await button('Reset').click();
    await page.waitForFunction(
      (previous) => window.__marsEngine.info().frames > previous + 3,
      frame,
    );
    const info = await page.evaluate(() => window.__marsEngine.info());
    expect({ geometries: info.geometries, textures: info.textures }).toEqual({
      geometries: baseline.geometries,
      textures: baseline.textures,
    });
    resets.push(info);
    expect(
      await page.evaluate(() => window.__marsEngine.chessTokens()),
    ).toEqual(original);
  }
  writeFileSync(
    path.join(artifacts, 'chess-reset-resources.json'),
    JSON.stringify({ baseline, resets }, null, 2),
  );
  await button('Step').click();
  expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual(
    [],
  );
  expect(errors).toEqual([]);
});

test('physical chess: interruption returns the original pawn, legal alternatives capture without spawning', async ({
  page,
}) => {
  mkdirSync(artifacts, { recursive: true });
  await page.goto('/lab?scenario=tabletop-chess');
  await page.waitForFunction(() => window.__marsEngine?.ready);
  await page.evaluate(() =>
    window.__marsEngine.runScenario('tabletop-chess', { paused: true }),
  );
  const button = (name: string) =>
    page.getByRole('button', { name, exact: true });
  const original = await page.evaluate(() => window.__marsEngine.chessTokens());
  await button('Play proposed move').click();
  await button('Play').click();
  await page.waitForFunction(() =>
    window.__marsEngine.heldItems().some((x) => x.id === 'white-pawn-f2'),
  );
  await button('Pause').click();
  await button('Interrupt chess move').click();
  await button('Play').click();
  await page.waitForFunction(
    () =>
      window.__marsEngine
        .records()
        .filter((r) => r.verb === 'chess_move')
        .at(-1)?.status === 'cancelled',
  );
  await button('Pause').click();
  expect(await page.evaluate(() => window.__marsEngine.chessTokens())).toEqual(
    original,
  );
  expect(await page.evaluate(() => window.__marsEngine.chess())).toMatchObject({
    position: { ply: 0 },
    pending: false,
  });
  await page.evaluate(() =>
    window.__marsEngine.camera([1.8, 1.9, -2.5], [-0.15, 0.8, 0]),
  );
  await page.screenshot({
    path: path.join(artifacts, 'chess-interrupted-same-pawn-restored.png'),
  });
  let completed = 0;
  for (const move of ['e2-e4', 'd7-d5', 'e4-d5']) {
    await page
      .getByRole('combobox', { name: 'Proposed chess move' })
      .selectOption(move);
    await button('Play proposed move').click();
    await button('Play').click();
    await page.waitForFunction((wanted) => {
      const s = window.__marsEngine.chess();
      return !('code' in s) && s.position.ply === wanted && !s.pending;
    }, ++completed);
    await button('Pause').click();
  }
  const final = await page.evaluate(() => window.__marsEngine.chessTokens());
  expect(final).toHaveLength(32);
  expect(final.map((x) => ({ id: x.id, def: x.def }))).toEqual(
    original.map((x) => ({ id: x.id, def: x.def })),
  );
  expect(final.find((x) => x.id === 'black-pawn-d7')?.support).toEqual({
    kind: 'resting-on',
    on: 'capture-tray',
    slot: 'captured-0',
  });
  expect(final.find((x) => x.id === 'white-pawn-e2')?.support).toEqual({
    kind: 'resting-on',
    on: 'board',
    slot: 'd5',
  });
  expect(await page.evaluate(() => window.__marsEngine.heldItems())).toEqual(
    [],
  );
  expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual(
    [],
  );
  await page.screenshot({
    path: path.join(artifacts, 'chess-capture-same-black-token-in-tray.png'),
  });
});
