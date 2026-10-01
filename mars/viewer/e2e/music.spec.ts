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
const artifacts = path.resolve('e2e/artifacts', process.env.E2E_RUN ?? 'music');
test('computer music: audible Play, independent departure, interruption and reset resource lifetime', async ({
  page,
}) => {
  mkdirSync(artifacts, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/lab?scenario=computer-music');
  await page.waitForFunction(() => window.__marsEngine?.ready);
  await page.evaluate(() =>
    window.__marsEngine.runScenario('computer-music', { paused: true }),
  );
  const button = (name: string) =>
    page.getByRole('button', { name, exact: true });
  await button('Reset').click();
  await button('Step').click();
  expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual(
    [],
  );
  await button('Enable sound').click();
  await button('Start music session').click();
  await button('Play').click();
  await page.waitForFunction(() => {
    const m = window.__marsEngine.music();
    const a = window.__marsEngine.musicAudio();
    return (
      m?.station &&
      !('code' in m.station) &&
      m.station.elapsed >= 4 &&
      m.sessions.at(-1)?.listeners.every((l) => l.state === 'listening') &&
      a.active === 1 &&
      a.voices[0].rms > 0.005
    );
  });
  await button('Pause').click();
  await expect
    .poll(() =>
      page.evaluate(() => window.__marsEngine.musicAudio().voices[0]?.rms),
    )
    .toBeLessThan(0.001);
  expect(
    await page.evaluate(() => window.__marsEngine.musicAudio().voices[0]?.note),
  ).toBeNull();
  await page.evaluate(() =>
    window.__marsEngine.camera([4, 3, -6], [0, 0.8, -1]),
  );
  await page.screenshot({
    path: path.join(artifacts, 'music-performer-and-listeners.png'),
  });
  await button('Direct listener away').click();
  await button('Play').click();
  await page.waitForFunction(() => {
    const s = window.__marsEngine.music()?.sessions.at(-1);
    return (
      s?.listeners[0].state === 'left' && s.listeners[1].state === 'listening'
    );
  });
  await button('Pause').click();
  await button('Interrupt music').click();
  await button('Play').click();
  await page.waitForFunction(
    () =>
      window.__marsEngine
        .records()
        .filter((r) => r.verb === 'computer_music')
        .at(-1)?.status === 'cancelled',
  );
  await button('Pause').click();
  const stopped = await page.evaluate(
    () => window.__marsEngine.music()?.station,
  );
  expect(stopped).toMatchObject({ status: 'unfinished', score: 'gentle' });
  expect(
    await page.evaluate(() =>
      window.__marsEngine.slots().filter((s) => s.claimedBy !== null),
    ),
  ).toEqual([]);
  await page.screenshot({
    path: path.join(artifacts, 'music-interrupted-retained-score.png'),
  });
  await button('Resume music').click();
  await button('Play').click();
  await page.waitForFunction(
    () =>
      window.__marsEngine
        .records()
        .filter((r) => r.verb === 'computer_music')
        .at(-1)?.status === 'completed',
  );
  await button('Pause').click();
  expect(
    await page.evaluate(() => window.__marsEngine.music()?.station),
  ).toMatchObject({
    status: 'completed',
    elapsed: 24,
    score: 'gentle',
    note: null,
  });
  expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual(
    [],
  );
  expect(
    await page.evaluate(() =>
      window.__marsEngine.slots().filter((s) => s.claimedBy !== null),
    ),
  ).toEqual([]);
  await page.screenshot({
    path: path.join(artifacts, 'music-completed-cleanup.png'),
  });
  for (let i = 0; i < 8; i++) {
    await button('Reset').click();
    await expect
      .poll(() => page.evaluate(() => window.__marsEngine.musicAudio().active))
      .toBe(0);
    await button('Enable sound').click();
    await expect
      .poll(() => page.evaluate(() => window.__marsEngine.musicAudio().active))
      .toBe(1);
  }
  await button('Reset').click();
  await expect
    .poll(() => page.evaluate(() => window.__marsEngine.musicAudio().active))
    .toBe(0);
  const final = await page.evaluate(() => window.__marsEngine.musicAudio());
  expect(final.opened).toBe(9);
  expect(final.closed).toBe(final.opened);
  expect(await page.evaluate(() => window.__marsEngine.records())).toEqual([]);
  expect(errors).toEqual([]);
});
