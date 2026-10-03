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
  process.env.E2E_RUN ?? 'music-gathering',
);
test('music dance: actual audible Play, grounded rhythm, late Join/Leave, same score Pause/Resume and Reset', async ({
  page,
}) => {
  mkdirSync(artifacts, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/lab?scenario=music-dance');
  await page.waitForFunction(() => window.__marsEngine?.ready);
  await page.evaluate(() =>
    window.__marsEngine.runScenario('music-dance', { paused: true }),
  );
  const button = (name: string) =>
    page.getByRole('button', { name, exact: true });
  await button('Enable sound').click();
  await button('Start music gathering').click();
  await button('Play').click();
  await page.waitForFunction(() => {
    const s = window.__marsEngine.music()?.station,
      a = window.__marsEngine.musicAudio();
    return (
      s &&
      !('code' in s) &&
      s.elapsed >= 4 &&
      a.active === 1 &&
      a.voices[0].rms > 0.005 &&
      window.__marsEngine.bones('dancer-a')['dancer-a']?.activity === 'dance'
    );
  });
  await button('Join dancer-b').click();
  await expect(page.getByTestId('music-gathering-dancer-b')).toContainText(
    'dancing',
  );
  const before = await page.evaluate(
    () => window.__marsEngine.humanFields()['dancer-a'].hands,
  );
  await page.evaluate(() =>
    window.__marsEngine.camera([4, 3.5, 6], [-0.6, 0.8, -0.2]),
  );
  await page.screenshot({
    path: path.join(artifacts, 'music-dance-live-four-person.png'),
  });
  await page.waitForFunction(
    (prior) =>
      JSON.stringify(window.__marsEngine.humanFields()['dancer-a'].hands) !==
      JSON.stringify(prior),
    before,
  );
  await button('Pause').click();
  await expect
    .poll(() =>
      page.evaluate(() => window.__marsEngine.musicAudio().voices[0]?.rms),
    )
    .toBeLessThan(0.001);
  const attention = await page.evaluate(() =>
    window.__marsEngine.activityAttentionTargets(),
  );
  expect(Object.keys(attention).length).toBeGreaterThanOrEqual(2);
  expect(
    Object.keys(attention).some(
      (actor) => actor === 'musician' || actor.startsWith('dancer-'),
    ),
  ).toBe(true);
  const grounded = await page.evaluate(() =>
    ['dancer-a', 'dancer-b'].map((id) => window.__marsEngine.bones(id)[id]),
  );
  for (const dancer of grounded) {
    expect(dancer.activity).toBe('dance');
    for (const arm of dancer.arms) {
      expect(arm.source).toBe('hands');
      expect(arm.ratio).not.toBeNull();
      expect(arm.ratio!).toBeLessThanOrEqual(1.02);
    }
  }
  await page.screenshot({
    path: path.join(artifacts, 'music-dance-grounded-pose.png'),
  });
  await button('Leave dancer-a').click();
  await button('Play').click();
  await expect(page.getByTestId('music-gathering-dancer-a')).toContainText(
    'left',
  );
  await expect(page.getByTestId('music-gathering-dancer-b')).toContainText(
    'dancing',
  );
  await button('Pause gathering').click();
  await page.waitForFunction(
    () =>
      window.__marsEngine
        .records()
        .filter((r) => r.verb === 'music_gathering')
        .at(-1)?.status === 'cancelled',
  );
  await button('Pause').click();
  const stopped = await page.evaluate(
    () => window.__marsEngine.music()?.station,
  );
  expect(stopped).toMatchObject({ status: 'unfinished', score: 'bright' });
  expect(
    await page.evaluate(() =>
      window.__marsEngine.slots().filter((s) => s.claimedBy !== null),
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(() =>
      Object.values(window.__marsEngine.humanFields()).filter(
        (h) => h.hands !== null,
      ),
    ),
  ).toEqual([]);
  await page.screenshot({
    path: path.join(artifacts, 'music-dance-safe-pause.png'),
  });
  await button('Resume gathering').click();
  await button('Play').click();
  await page.waitForFunction(
    () =>
      window.__marsEngine
        .records()
        .filter((r) => r.verb === 'music_gathering')
        .at(-1)?.status === 'completed',
  );
  await button('Pause').click();
  expect(
    await page.evaluate(() => window.__marsEngine.music()?.station),
  ).toMatchObject({
    status: 'completed',
    elapsed: 36,
    score: 'bright',
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
    path: path.join(artifacts, 'music-dance-complete.png'),
  });
  await button('Reset').click();
  await expect
    .poll(() => page.evaluate(() => window.__marsEngine.musicAudio().active))
    .toBe(0);
  expect(await page.evaluate(() => window.__marsEngine.records())).toEqual([]);
  expect(errors).toEqual([]);
});
