/// <reference types="node" />
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
declare global {
  interface Window {
    __marsEngine: EngineHook;
  }
}
type WarmupSample = {
  tick: number;
  participants: { actor: string; state?: string }[];
};
const artifacts = path.resolve(
  'e2e/artifacts',
  process.env.E2E_RUN ?? 'activity-vocabulary',
);
const button = (p: Page, n: string) =>
  p.getByRole('button', { name: n, exact: true });
async function open(p: Page, scenario: string) {
  mkdirSync(artifacts, { recursive: true });
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (e) => {
    if (e.type() === 'error') errors.push(e.text());
  });
  await p.goto(`/lab?scenario=${scenario}`);
  await p.waitForFunction(() => window.__marsEngine?.ready);
  await p.evaluate(
    (n) => window.__marsEngine.runScenario(n, { paused: true, speed: 2 }),
    scenario,
  );
  await button(p, 'Reset').click();
  await button(p, 'Step').click();
  expect((await p.evaluate(() => window.__marsEngine.state())).tick).toBe(1);
  expect(await p.evaluate(() => window.__marsEngine.violations())).toEqual([]);
  return errors;
}
async function capture(p: Page, n: string) {
  await p.screenshot({ path: path.join(artifacts, `${n}.png`) });
  writeFileSync(
    path.join(artifacts, `${n}.a11y.yml`),
    await p.locator('body').ariaSnapshot(),
  );
}
async function clean(p: Page) {
  expect(await p.evaluate(() => window.__marsEngine.violations())).toEqual([]);
  expect(await p.evaluate(() => window.__marsEngine.heldItems())).toEqual([]);
  expect(
    await p.evaluate(() =>
      window.__marsEngine.slots().filter((s) => s.claimedBy !== null),
    ),
  ).toEqual([]);
  expect(
    await p.evaluate(() =>
      window.__marsEngine.state().humans.filter((h) => h.task !== null),
    ),
  ).toEqual([]);
  expect(
    await p.evaluate(() =>
      Object.values(window.__marsEngine.humanFields()).filter(
        (h) => h.hands !== null,
      ),
    ),
  ).toEqual([]);
}
async function reset(p: Page) {
  await button(p, 'Reset').click();
  expect(await p.evaluate(() => window.__marsEngine.records())).toEqual([]);
  await button(p, 'Step').click();
  expect((await p.evaluate(() => window.__marsEngine.state())).tick).toBe(1);
  expect(await p.evaluate(() => window.__marsEngine.violations())).toEqual([]);
}
function proof(n: string, v: object) {
  writeFileSync(
    path.join(artifacts, `${n}.json`),
    JSON.stringify(
      { source: '65ee693', run: process.env.E2E_RUN, ...v },
      null,
      2,
    ),
  );
}

test.afterEach(async ({ page }, info) => {
  const name = info.title.startsWith('drawing')
    ? 'drawing'
    : info.title.startsWith('warm-up')
      ? 'warmup'
      : 'jam';
  const evidence = await page.evaluate(() => ({
    state: window.__marsEngine.state(),
    drawing: window.__marsEngine.drawing(),
    warmup: window.__marsEngine.warmup(),
    jam: window.__marsEngine.openJam(),
    records: window.__marsEngine.records(),
    violations: window.__marsEngine.violations(),
    slots: window.__marsEngine.slots(),
    components: window.__marsEngine.components(),
    held: window.__marsEngine.heldItems(),
    hands: window.__marsEngine.humanFields(),
    attention: window.__marsEngine.activityAttentionTargets(),
    audio: window.__marsEngine.musicAudio(),
  }));
  proof(`${name}-final-evidence`, {
    status: info.status,
    errors: info.errors.map((e) => e.message),
    evidence,
  });
  if (info.status !== info.expectedStatus)
    await capture(page, `${name}-failure`);
});

test('drawing actual Play retains partial strokes and same pencil; Resume finishes eight visible marks and returns pencil', async ({
  page: p,
}) => {
  const errors = await open(p, 'drawing-work'),
    original = await p.evaluate(() => window.__marsEngine.components());
  await p.evaluate(() =>
    window.__marsEngine.camera([2.5, 2.6, -3], [0, 0.8, -0.3]),
  );
  await button(p, 'Start drawing').click();
  await button(p, 'Play').click();
  await p.waitForFunction(() => {
    const d = window.__marsEngine.drawing();
    return !('code' in d) && d.ticks >= 35 && d.ticks < 120;
  });
  await button(p, 'Pause').click();
  const partial = await p.evaluate(() => window.__marsEngine.drawing());
  if ('code' in partial) throw Error(partial.message);
  expect(partial.status).toBe('active');
  expect(partial.ticks).toBeLessThan(160);
  expect(partial.completedMarks.length).toBeGreaterThan(0);
  const held = await p.evaluate(() => window.__marsEngine.heldItems());
  expect(held).toHaveLength(1);
  expect(held[0]).toMatchObject({
    id: 'sketch-pencil',
    def: 'drawing-pencil',
    by: 'sketcher',
    hand: 'right',
  });
  expect(held[0].palm).not.toBeNull();
  await capture(p, 'drawing-partial-held-pencil');
  await button(p, 'Pause drawing').click();
  await button(p, 'Play').click();
  await p.waitForFunction(
    () =>
      window.__marsEngine
        .records()
        .filter((r) => r.verb === 'drawing_work')
        .at(-1)?.status === 'cancelled',
  );
  await button(p, 'Pause').click();
  const stopped = await p.evaluate(() => window.__marsEngine.drawing());
  expect(stopped).toMatchObject({
    status: 'unfinished',
    ticks: partial.ticks,
    completedMarks: partial.completedMarks,
    activeMark: partial.activeMark,
  });
  await clean(p);
  expect(
    await p.evaluate(
      () =>
        window.__marsEngine.components().find((c) => c.id === 'sketch-pencil')
          ?.pose,
    ),
  ).toEqual(original.find((c) => c.id === 'sketch-pencil')!.pose);
  await p.evaluate(() =>
    window.__marsEngine.camera([-0.15, 1.5, -0.15], [-0.15, 0.765, -0.3]),
  );
  await capture(p, 'drawing-retained-partial-pad');
  await button(p, 'Resume drawing').click();
  await button(p, 'Play').click();
  await p.waitForFunction(
    () =>
      window.__marsEngine
        .records()
        .filter((r) => r.verb === 'drawing_work')
        .at(-1)?.status === 'completed',
  );
  await button(p, 'Pause').click();
  const complete = await p.evaluate(() => window.__marsEngine.drawing());
  expect(complete).toMatchObject({
    status: 'completed',
    ticks: 160,
    totalMarks: 8,
  });
  if ('code' in complete) throw Error(complete.message);
  expect(complete.completedMarks).toHaveLength(8);
  expect(complete.activeMark).toBeUndefined();
  await clean(p);
  const components = await p.evaluate(() => window.__marsEngine.components());
  expect(components.map((c) => [c.id, c.def, c.support, c.pose])).toEqual(
    original.map((c) => [c.id, c.def, c.support, c.pose]),
  );
  await capture(p, 'drawing-complete-eight-marks');
  await reset(p);
  expect(await p.evaluate(() => window.__marsEngine.drawing())).toMatchObject({
    status: 'idle',
    ticks: 0,
    completedMarks: [],
  });
  expect(errors).toEqual([]);
  proof('drawing-proof', {
    original,
    partial,
    held,
    stopped,
    complete,
    components,
    errors,
  });
});

test('warm-up actual Play phases five rigs; Leave/Join and Pause/Resume retain instructor clock', async ({
  page: p,
}) => {
  const errors = await open(p, 'group-warmup');
  await p.evaluate(() => window.__marsEngine.camera([7, 6, -9], [-1, 0.8, 0]));
  await button(p, 'Start warm-up').click();
  await button(p, 'Play').click();
  await p.evaluate(() => {
    (window as unknown as { warmupSamples: WarmupSample[] }).warmupSamples = [];
  });
  await p.waitForFunction(() => {
    const s = window.__marsEngine.warmup();
    if (!s) return false;
    (window as unknown as { warmupSamples: WarmupSample[] }).warmupSamples.push(
      {
        tick: window.__marsEngine.state().tick,
        participants: s.participants.map((p) => ({
          actor: p.actor,
          state: p.state,
          timing: p.timing,
        })),
      },
    );
    return (
      s.elapsed >= 8 &&
      s.participants.every((p) =>
        ['settle', 'raise', 'open', 'lower'].includes(p.state ?? ''),
      ) &&
      new Set(s.participants.map((p) => p.state)).size > 1
    );
  });
  await button(p, 'Pause').click();
  const phased = await p.evaluate(() => ({
    s: window.__marsEngine.warmup(),
    attention: window.__marsEngine.activityAttentionTargets(),
    bones: window.__marsEngine.bones(),
    samples: (window as unknown as { warmupSamples: WarmupSample[] })
      .warmupSamples,
  }));
  expect(phased.s!.participants).toHaveLength(5);
  const arrivals = new Map<string, number>();
  for (const sample of phased.samples)
    for (const member of sample.participants)
      if (
        ['settle', 'raise', 'open', 'lower'].includes(member.state ?? '') &&
        !arrivals.has(member.actor)
      )
        arrivals.set(member.actor, sample.tick);
  expect(arrivals.size).toBe(5);
  expect(new Set(arrivals.values()).size).toBe(5);
  expect(Object.keys(phased.attention)).toEqual(
    expect.arrayContaining([
      'follower-1',
      'follower-2',
      'follower-3',
      'follower-4',
    ]),
  );
  for (const member of phased.s!.participants) {
    expect(member.hands).toBeDefined();
    const b = phased.bones[member.actor];
    expect(b).toBeDefined();
    for (const arm of b.arms) {
      expect(arm.source).toBe('hands');
      expect(arm.ratio).not.toBeNull();
      expect(arm.ratio!).toBeLessThanOrEqual(1.02);
    }
  }
  await capture(p, 'warmup-five-independent-phases');
  await button(p, 'Leave follower-2').click();
  await button(p, 'Play').click();
  await expect(p.getByTestId('warmup-follower-2')).toContainText('left');
  await button(p, 'Pause').click();
  const departed = await p.evaluate(() => window.__marsEngine.warmup());
  expect(departed!.participants[2].withdrawn).toBe(true);
  await button(p, 'Join follower-2').click();
  await button(p, 'Play').click();
  await p.waitForFunction(() =>
    ['settle', 'raise', 'open', 'lower'].includes(
      window.__marsEngine.warmup()?.participants[2].state ?? '',
    ),
  );
  await button(p, 'Pause').click();
  const before = await p.evaluate(() => window.__marsEngine.warmup());
  await button(p, 'Pause warm-up').click();
  await button(p, 'Play').click();
  await p.waitForFunction(
    () => window.__marsEngine.warmup()?.status === 'cancelled',
  );
  await button(p, 'Pause').click();
  const stopped = await p.evaluate(() => window.__marsEngine.warmup());
  expect(stopped!.elapsed).toBe(before!.elapsed);
  expect(stopped!.ended).toBe(false);
  await clean(p);
  await capture(p, 'warmup-safe-pause-clock-retained');
  await button(p, 'Resume warm-up').click();
  const bound = await p.evaluate(() => window.__marsEngine.warmup());
  expect(bound!.elapsed).toBe(stopped!.elapsed);
  await button(p, 'Play').click();
  await p.waitForFunction(
    () => window.__marsEngine.warmup()?.status === 'completed',
  );
  await button(p, 'Pause').click();
  const complete = await p.evaluate(() => window.__marsEngine.warmup());
  expect(complete).toMatchObject({ elapsed: 24, ended: true });
  await clean(p);
  await capture(p, 'warmup-complete-released');
  await reset(p);
  expect(await p.evaluate(() => window.__marsEngine.warmup())).toBeNull();
  expect(errors).toEqual([]);
  proof('warmup-proof', {
    phased,
    departed,
    before,
    stopped,
    bound,
    complete,
    errors,
  });
});

test('open jam audible actual Play; directive retains first score, same computer/chair handoff and later withdrawal', async ({
  page: p,
}) => {
  const errors = await open(p, 'open-jam'),
    fixtures = await p.evaluate(() => window.__marsEngine.fixtures());
  await p.evaluate(() =>
    window.__marsEngine.camera([5, 4, -7], [-0.5, 0.9, 0]),
  );
  await button(p, 'Enable sound').click();
  await button(p, 'Start open jam').click();
  await button(p, 'Play').click();
  await p.waitForFunction(() => {
    const s = window.__marsEngine.music()?.station,
      a = window.__marsEngine.musicAudio();
    return (
      !!s &&
      !('code' in s) &&
      s.elapsed >= 3 &&
      s.elapsed < 10 &&
      a.active === 1 &&
      a.voices[0]?.rms > 0.005
    );
  });
  await button(p, 'Pause').click();
  const original = await p.evaluate(() => ({
    jam: window.__marsEngine.openJam(),
    music: window.__marsEngine.music(),
    audio: window.__marsEngine.musicAudio(),
    slots: window.__marsEngine.slots(),
  }));
  expect(
    original.slots.find((s) => s.id === 'music-chair#seat')?.occupant,
  ).toBe('musician');
  expect(original.jam!.index).toBe(0);
  if (!original.music.station || 'code' in original.music.station)
    throw Error('No actual first score');
  await capture(p, 'jam-first-performer-real-station');
  await button(p, 'Leave dance floor').click();
  await button(p, 'Direct current performer away').click();
  await button(p, 'Play').click();
  await p.waitForFunction(
    () =>
      window.__marsEngine.openJam()?.mode === 'paused' &&
      window.__marsEngine
        .records()
        .filter((r) => r.verb === 'walk_to' && !r.parent)
        .at(-1)?.status === 'completed',
  );
  await button(p, 'Pause').click();
  const stopped = await p.evaluate(() => ({
    jam: window.__marsEngine.openJam(),
    music: window.__marsEngine.music(),
    records: window.__marsEngine.records(),
  }));
  expect(stopped.jam!.finished).toEqual([]);
  expect(stopped.music.station).toMatchObject({
    status: 'unfinished',
    score: 'bright',
    elapsed: original.music.station!.elapsed,
  });
  await clean(p);
  await capture(p, 'jam-directive-retained-score');
  await button(p, 'Resume jam').click();
  await button(p, 'Play').click();
  await p.waitForFunction(
    () =>
      window.__marsEngine.openJam()?.mode === 'clearing' &&
      window.__marsEngine.openJam()?.finished.length === 1,
  );
  await button(p, 'Pause').click();
  const handoff = await p.evaluate(() => ({
    jam: window.__marsEngine.openJam(),
    slots: window.__marsEngine.slots(),
    state: window.__marsEngine.state(),
  }));
  expect(handoff.jam!.finished[0]).toMatchObject({
    actor: 'musician',
    score: 'bright',
    playedSeconds: 12,
  });
  await capture(p, 'jam-physical-performer-handoff');
  await button(p, 'Play').click();
  await p.waitForFunction(() => {
    const s = window.__marsEngine.music()?.station;
    return (
      window.__marsEngine.openJam()?.index === 1 &&
      !!s &&
      !('code' in s) &&
      s.elapsed >= 2 &&
      s.phase === 'working'
    );
  });
  await button(p, 'Pause').click();
  const second = await p.evaluate(() => ({
    jam: window.__marsEngine.openJam(),
    music: window.__marsEngine.music(),
    slots: window.__marsEngine.slots(),
    fixtures: window.__marsEngine.fixtures(),
  }));
  expect(second.slots.find((s) => s.id === 'music-chair#seat')?.occupant).toBe(
    'guest-musician',
  );
  expect(second.jam!.departed).toContain('dancer-a');
  expect(
    second.jam!.current!.dancers[0].withdrawn ||
      !second.jam!.current!.dancers[0].invited,
  ).toBe(true);
  expect(second.fixtures.map((f) => [f.id, f.def, f.pose])).toEqual(
    fixtures.map((f) => [f.id, f.def, f.pose]),
  );
  await capture(p, 'jam-second-performer-same-computer');
  await button(p, 'Play').click();
  await p.waitForFunction(
    () => window.__marsEngine.openJam()?.mode === 'completed',
  );
  await button(p, 'Pause').click();
  const complete = await p.evaluate(() => ({
    jam: window.__marsEngine.openJam(),
    music: window.__marsEngine.music(),
    records: window.__marsEngine.records(),
  }));
  expect(
    complete.jam!.finished.map((f) => [f.actor, f.score, f.playedSeconds]),
  ).toEqual([
    ['musician', 'bright', 12],
    ['guest-musician', 'gentle', 14],
  ]);
  await clean(p);
  await reset(p);
  await expect
    .poll(() => p.evaluate(() => window.__marsEngine.musicAudio().active))
    .toBe(0);
  expect(await p.evaluate(() => window.__marsEngine.openJam())).toBeNull();
  expect(errors).toEqual([]);
  proof('jam-proof', {
    fixtures,
    original,
    stopped,
    handoff,
    second,
    complete,
    errors,
  });
});
