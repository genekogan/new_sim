/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
declare global {
  interface Window {
    __marsEngine: EngineHook;
  }
}
const artifacts = path.resolve(
  'e2e/artifacts',
  process.env.E2E_RUN ?? 'reading',
);
test('quiet reading: fresh Step, actual Play, interrupted bookmark and same-book completion', async ({
  page,
}) => {
  mkdirSync(artifacts, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/lab?scenario=quiet-reading');
  await page.waitForFunction(() => window.__marsEngine?.ready);
  await page.evaluate(() =>
    window.__marsEngine.runScenario('quiet-reading', { paused: true }),
  );
  const button = (name: string) =>
    page.getByRole('button', { name, exact: true });
  await button('Reset').click();
  await button('Step').click();
  expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual(
    [],
  );
  const before = await page.evaluate(() =>
    window.__marsEngine.components().find((c) => c.id === 'book'),
  );
  await button('Start reading').click();
  await button('Play').click();
  await page.waitForFunction(() => {
    const s = window.__marsEngine.reading();
    return 'elapsed' in s && s.elapsed >= 7;
  });
  await button('Pause').click();
  await page.evaluate(() =>
    window.__marsEngine.camera([1.2, 1.7, -2.2], [-0.15, 0.85, -0.5]),
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.screenshot({
    path: path.join(artifacts, 'reading-seated-section-two.png'),
  });
  const progress = await page.evaluate(() => window.__marsEngine.reading());
  expect(progress).toMatchObject({
    status: 'active',
    phase: 'reading',
    page: 2,
  });
  await button('Interrupt reading').click();
  await button('Play').click();
  await page.waitForFunction(
    () =>
      window.__marsEngine
        .records()
        .filter((r) => r.verb === 'read_book')
        .at(-1)?.status === 'cancelled',
  );
  await button('Pause').click();
  const stopped = await page.evaluate(() => window.__marsEngine.reading());
  expect(stopped).toMatchObject({ status: 'unfinished', page: 2 });
  expect(
    await page.evaluate(() =>
      window.__marsEngine.slots().filter((s) => s.claimedBy !== null),
    ),
  ).toEqual([]);
  await page.screenshot({
    path: path.join(artifacts, 'reading-interrupted-bookmark.png'),
  });
  await button('Resume reading').click();
  await button('Play').click();
  await page.waitForFunction(
    () =>
      window.__marsEngine
        .records()
        .filter((r) => r.verb === 'read_book')
        .at(-1)?.status === 'completed',
  );
  await button('Pause').click();
  expect(
    await page.evaluate(() => window.__marsEngine.reading()),
  ).toMatchObject({ status: 'completed', elapsed: 24, page: 4 });
  await expect(
    page.getByRole('status').filter({ hasText: 'Reading complete.' }),
  ).toBeVisible();
  const after = await page.evaluate(() =>
    window.__marsEngine.components().find((c) => c.id === 'book'),
  );
  expect(after?.pose).toEqual(before?.pose);
  expect(after?.support).toEqual(before?.support);
  expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual(
    [],
  );
  expect(
    await page.evaluate(() =>
      window.__marsEngine.slots().filter((s) => s.claimedBy !== null),
    ),
  ).toEqual([]);
  await page.screenshot({
    path: path.join(artifacts, 'reading-completed-same-book.png'),
  });
  await button('Reset').click();
  await button('Step').click();
  expect(
    await page.evaluate(() => window.__marsEngine.reading()),
  ).toMatchObject({ status: 'idle', elapsed: 0, page: 1 });
  expect(await page.evaluate(() => window.__marsEngine.records())).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual(
    [],
  );
  expect(errors).toEqual([]);
});
