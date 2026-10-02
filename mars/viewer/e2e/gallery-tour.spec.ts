/// <reference types="node" />
import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
import type { readGalleryTour } from '../engine/activities/gallery-tour.ts';
declare global {
  interface Window {
    __marsEngine: EngineHook;
  }
}
// Root supplies this read-only hook; no shared interface mutation in this lane.
type GalleryHook = EngineHook & {
  galleryTour: () => ReturnType<typeof readGalleryTour> | null;
};
const source = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
const directory = path.resolve(
  'e2e/artifacts',
  process.env.E2E_RUN ?? 'gallery-tour',
);
const logs = new WeakMap<Page, string[]>();
const button = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true });
async function inspect(page: Page) {
  return page.evaluate(() => {
    const h = window.__marsEngine as GalleryHook;
    return {
      state: h.state(),
      tour: h.galleryTour(),
      records: h.records(),
      violations: h.violations(),
      components: h.components(),
      fixtures: h.fixtures(),
      entities: h.cameraEntities(),
      slots: h.slots(),
      held: h.heldItems(),
      hands: h.humanFields(),
      bones: h.bones(),
      attention: h.activityAttentionTargets(),
      cameraFacts: h.cameraActivityReadout(),
      audio: h.musicAudio(),
    };
  });
}
type Evidence = Awaited<ReturnType<typeof inspect>>;
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
async function open(page: Page, scenario: string) {
  mkdirSync(directory, { recursive: true });
  const errors: string[] = [];
  logs.set(page, errors);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error') errors.push(e.text());
  });
  await page.goto(`/lab?scenario=${scenario}`);
  await page.waitForFunction(() => window.__marsEngine?.ready);
  await page.evaluate(
    (name) => window.__marsEngine.runScenario(name, { paused: true, speed: 4 }),
    scenario,
  );
  await reset(page);
  await expect(page.getByTestId('gallery-tour-hud')).toContainText(
    'Hypothetical pre-made',
  );
  return inspect(page);
}
async function reset(page: Page) {
  await button(page, 'Reset').click();
  expect(await page.evaluate(() => window.__marsEngine.records())).toEqual([]);
  await button(page, 'Step').click(); // Fresh first-tick check only; activity execution always uses Play.
  const s = await inspect(page);
  expect(s.state.tick).toBe(1);
  expect(s.tour).toBeNull();
  expect(s.violations).toEqual([]);
  expect(s.audio.active).toBe(0);
}
async function formed(page: Page, index: number) {
  await page.waitForFunction((i) => {
    const s = (window.__marsEngine as GalleryHook).galleryTour();
    return (
      s?.index === i &&
      s.current?.mode === 'sharing' &&
      s.current.participants
        .filter((p) => p.active)
        .every((p) => p.physicallyViewing)
    );
  }, index);
}
function sameArt(s: Evidence, initial: Evidence) {
  const components = (e: Evidence) =>
    e.components.map((c) => [c.id, c.def, c.pose, c.support]);
  const fixtures = (e: Evidence) =>
    e.fixtures.map((c) => [c.id, c.def, c.pose, c.support]);
  expect(components(s)).toEqual(components(initial));
  expect(fixtures(s)).toEqual(fixtures(initial));
  expect(s.entities.map((e) => e.id).sort()).toEqual(
    initial.entities.map((e) => e.id).sort(),
  );
}
function viewing(s: Evidence, index: number) {
  const circle = s.tour!.current!;
  expect(circle.pad).toBe(`gallery${index + 1}-sketch-pad`);
  expect(circle.artifact?.id).toBe(circle.pad);
  expect(circle.artifact?.marks).toHaveLength(8);
  expect(circle.artifact?.support).toMatchObject({
    kind: 'resting-on',
    on: `gallery${index + 1}-sketch-table`,
  });
  expect(circle.attentionTarget?.entity).toBe(circle.pad);
  expect(circle.floorHolder).toBeDefined();
  const fact = s.cameraFacts.activities.find((a) => a.id === s.tour!.tour);
  expect(fact).toMatchObject({
    mode: s.tour!.mode,
    focus: circle.floorHolder,
    objects: [circle.pad],
  });
  expect(fact!.actors.slice().sort()).toEqual(
    s.tour!.members.filter((m) => m.active).map((m) => m.actor).sort(),
  );
  for (const m of circle.participants.filter((m) => m.active)) {
    expect(m.physicallyViewing).toBe(true);
    expect(s.attention[m.actor]).toBeDefined();
    expect(s.bones[m.actor].activity).toBe(m.speaking ? 'talk' : 'listen');
    expect(Math.abs(Math.min(...s.bones[m.actor].soles))).toBeLessThanOrEqual(
      0.03,
    );
    expect(s.state.humans.find((h) => h.id === m.actor)?.p[1]).toBe(0);
  }
}
function clean(s: Evidence) {
  expect(s.violations).toEqual([]);
  expect(s.held).toEqual([]);
  expect(s.slots.filter((v) => v.claimedBy !== null)).toEqual([]);
  expect(s.state.humans.filter((h) => h.task !== null)).toEqual([]);
  expect(Object.values(s.hands).filter((h) => h.hands !== null)).toEqual([]);
  expect(
    s.records.filter((r) => !['completed', 'cancelled'].includes(r.status)),
  ).toEqual([]);
}
function departuresBeforeNext(s: Evidence) {
  const circles = s.tour!.history.map((h) => h.sharing);
  if (
    s.tour!.current &&
    !circles.some((c) => c.session === s.tour!.current!.session)
  )
    circles.push(s.tour!.current);
  for (let i = 1; i < circles.length; i++) {
    const prior = s.records.find((r) => r.id === circles[i - 1].session)!,
      next = s.records.find((r) => r.id === circles[i].session)!;
    const walks = s.records.filter(
      (r) =>
        r.verb === 'walk_to' &&
        r.parent === s.tour!.tour &&
        r.requestedTick >= prior.endedTick &&
        r.requestedTick < next.requestedTick,
    );
    expect(walks).toHaveLength(
      circles[i - 1].participants.filter((p) => p.active).length,
    );
    for (const w of walks) {
      expect(w.status).toBe('completed');
      expect(w.endedTick).toBeLessThanOrEqual(next.requestedTick);
    }
    for (const member of circles[i - 1].participants)
      if (member.departure) {
        const departure = s.records.find((r) => r.id === member.departure)!;
        expect(departure.status).toBe('completed');
        expect(departure.endedTick).toBeLessThanOrEqual(next.requestedTick);
      }
  }
}
test.afterEach(async ({ page }, info) => {
  const name = info.title.startsWith('three')
    ? 'gallery-default'
    : 'gallery-short';
  save(`${name}-result`, {
    status: info.status,
    errors: info.errors.map((e) => e.message),
    pageErrors: logs.get(page) ?? [],
    state: await inspect(page),
  });
  if (info.status !== info.expectedStatus)
    await capture(page, `${name}-failure`, false);
});

test('three-stop actual Play continuity, physical question-answer, exact Pause-Resume and explicit End-Reset', async ({
  page,
}) => {
  const initial = await open(page, 'gallery-tour');
  await page.evaluate(() =>
    window.__marsEngine.camera([-1, 4, -6], [-5, 0.8, 0]),
  );
  await button(page, 'Start gallery tour').click();
  await play(page);
  await formed(page, 0);
  const first = await capture(page, 'gallery-default-first-real-pad');
  viewing(first, 0);
  sameArt(first, initial);
  await button(page, 'Ask art-visitor1').click();
  await play(page);
  await page.waitForFunction(() => {
    const s = (window.__marsEngine as GalleryHook).galleryTour();
    return s?.current?.pendingQuestion !== undefined;
  });
  const question = await capture(page, 'gallery-default-retained-question');
  const questionIndex = question.tour!.current!.pendingQuestion!;
  expect(question.tour!.current!.effects[questionIndex]).toMatchObject({
    actor: 'art-visitor1',
    kind: 'question',
    pad: 'gallery1-sketch-pad',
    marks: 8,
  });
  await button(page, 'Answer art-visitor2').click();
  // The accepted floor request commits while globally paused, then Pause retains it.
  await play(page);
  await page.waitForFunction(
    () =>
      !(window.__marsEngine as GalleryHook)
        .records()
        .some(
          (r) =>
            r.verb === 'gallery_tour_control' &&
            !['completed', 'cancelled', 'failed'].includes(r.status),
        ),
  );
  await freeze(page);
  const beforePause = await inspect(page);
  await button(page, 'Pause tour').click();
  await play(page);
  await page.waitForFunction(
    () => (window.__marsEngine as GalleryHook).galleryTour()?.mode === 'paused',
  );
  const paused = await capture(page, 'gallery-default-exact-safe-pause');
  expect(paused.tour!.current!.elapsed).toBe(
    beforePause.tour!.current!.elapsed,
  );
  expect(paused.tour!.current!.effects).toEqual(
    beforePause.tour!.current!.effects,
  );
  expect(paused.tour!.history).toEqual(beforePause.tour!.history);
  expect(paused.slots.filter((s) => s.claimedBy !== null)).toEqual([]);
  await button(page, 'Resume tour').click();
  await play(page);
  await formed(page, 0);
  await freeze(page);
  const resumed = await inspect(page);
  expect(resumed.tour!.current!.session).toBe(paused.tour!.current!.session);
  expect(resumed.tour!.current!.elapsed).toBeGreaterThanOrEqual(
    paused.tour!.current!.elapsed,
  );
  await play(page);
  await formed(page, 1);
  await freeze(page);
  await page.evaluate(() => window.__marsEngine.camera([4, 4, 0], [0, 0.8, 5]));
  const second = await capture(page, 'gallery-default-second-same-artifact');
  viewing(second, 1);
  sameArt(second, initial);
  expect(second.tour!.history).toHaveLength(1);
  expect(second.tour!.history[0].sharing.effects).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        actor: 'art-visitor2',
        kind: 'answer',
        replyTo: questionIndex,
      }),
    ]),
  );
  await button(page, 'Floor art-visitor2').click();
  await play(page);
  await page.waitForFunction(
    () =>
      (window.__marsEngine as GalleryHook).galleryTour()?.current
        ?.floorHolder === 'art-visitor2',
  );
  await freeze(page);
  await play(page);
  await formed(page, 2);
  await freeze(page);
  await page.evaluate(() =>
    window.__marsEngine.camera([9, 4, -6], [5, 0.8, 0]),
  );
  const third = await capture(
    page,
    'gallery-default-third-real-pad-retained-history',
  );
  viewing(third, 2);
  sameArt(third, initial);
  expect(third.tour!.history.map((h) => h.pad)).toEqual([
    'gallery1-sketch-pad',
    'gallery2-sketch-pad',
  ]);
  departuresBeforeNext(third);
  const previous = third.tour!.history;
  await button(page, 'End tour').click();
  await play(page);
  await page.waitForFunction(
    () =>
      (window.__marsEngine as GalleryHook).galleryTour()?.mode === 'completed',
  );
  const ended = await capture(page, 'gallery-default-explicit-end-clean');
  clean(ended);
  sameArt(ended, initial);
  expect(ended.tour!.finished).toBe(false);
  expect(ended.tour!.history).toEqual(previous);
  expect(ended.tour!.status).toBe('cancelled');
  await reset(page);
  expect(logs.get(page)).toEqual([]);
  save('gallery-default-proof', {
    initial,
    first,
    question,
    beforePause,
    paused,
    resumed,
    second,
    third,
    ended,
  });
});

test('two-stop actual Play Leave persists, named audience wait, declared late Join, host directive Resume and final cleanup', async ({
  page,
}) => {
  const initial = await open(page, 'gallery-tour-short');
  await page.evaluate(() =>
    window.__marsEngine.camera([-1, 4, -6], [-5, 0.8, 0]),
  );
  await button(page, 'Start gallery tour').click();
  await play(page);
  await formed(page, 0);
  const first = await capture(page, 'gallery-short-first-viewers');
  viewing(first, 0);
  const beforeCamera = await page.evaluate(() => ({
    tick: window.__marsEngine.state().tick,
    hash: window.__marsEngine.stateHash(),
  }));
  await page.getByRole('combobox', { name: 'Live camera', exact: true }).selectOption('clear');
  await expect(page.getByText(/^AUTO · clear/)).toBeVisible();
  expect(await page.evaluate(() => ({
    tick: window.__marsEngine.state().tick,
    hash: window.__marsEngine.stateHash(),
  }))).toEqual(beforeCamera);
  await page.getByRole('combobox', { name: 'Live camera', exact: true }).selectOption('off');
  await expect(page.getByText(/^AUTO · clear/)).toHaveCount(0);
  await button(page, 'Leave art-visitor1').click();
  await play(page);
  await page.waitForFunction(() => {
    const s = (window.__marsEngine as GalleryHook).galleryTour();
    return (
      s?.index === 1 &&
      s.diagnostic?.code === 'gallery_tour.insufficient-audience'
    );
  });
  const waiting = await capture(
    page,
    'gallery-short-persistent-leave-audience-wait',
  );
  expect(
    waiting.tour!.members.find((m) => m.actor === 'art-visitor1'),
  ).toMatchObject({ active: false, state: 'left' });
  expect(waiting.tour!.history).toHaveLength(1);
  expect(waiting.records.filter((r) => r.status === 'failed')).toEqual([]);
  const departure = waiting.tour!.history[0].sharing.participants.find(
    (m) => m.actor === 'art-visitor1',
  )!.departure!;
  expect(waiting.records.find((r) => r.id === departure)?.status).toBe(
    'completed',
  );
  await button(page, 'Join art-visitor3').click();
  await play(page);
  await formed(page, 1);
  await freeze(page);
  await page.evaluate(() => window.__marsEngine.camera([4, 4, 0], [0, 0.8, 5]));
  const joined = await capture(
    page,
    'gallery-short-declared-late-physical-viewer',
  );
  viewing(joined, 1);
  expect(
    joined.tour!.current!.participants.find((m) => m.actor === 'art-visitor3')!
      .physicallyViewing,
  ).toBe(true);
  expect(
    joined.tour!.current!.participants.find((m) => m.actor === 'art-visitor1')!
      .active,
  ).toBe(false);
  await button(page, 'Direct host away').click();
  await play(page);
  await page.waitForFunction(() => {
    const h = window.__marsEngine as GalleryHook,
      s = h.galleryTour(),
      r = h
        .records()
        .filter(
          (r) =>
            r.verb === 'walk_to' &&
            !r.parent &&
            (r.params as { actor?: string }).actor === 'sketcher',
        )
        .at(-1);
    return s?.mode === 'paused' && r?.status === 'completed';
  });
  const directed = await capture(
    page,
    'gallery-short-directed-host-retains-discussion',
  );
  expect(directed.tour!.current!.elapsed).toBe(joined.tour!.current!.elapsed);
  expect(directed.tour!.current!.effects).toEqual(
    joined.tour!.current!.effects,
  );
  expect(directed.state.humans.find((h) => h.id === 'sketcher')?.p).toEqual([
    -8, 0, -8,
  ]);
  await button(page, 'Resume tour').click();
  await play(page);
  await formed(page, 1);
  await freeze(page);
  const resumed = await inspect(page);
  expect(resumed.tour!.current!.session).toBe(joined.tour!.current!.session);
  viewing(resumed, 1);
  await play(page);
  await page.waitForFunction(
    () => (window.__marsEngine as GalleryHook).galleryTour()?.finished === true,
  );
  const complete = await capture(
    page,
    'gallery-short-completed-two-real-stops',
  );
  clean(complete);
  sameArt(complete, initial);
  expect(complete.tour!.status).toBe('completed');
  expect(complete.tour!.history.map((h) => h.pad)).toEqual([
    'gallery1-sketch-pad',
    'gallery2-sketch-pad',
  ]);
  expect(
    complete.tour!.history.every(
      (h) => h.sharing.artifact!.marks.length === 8 && h.sharing.finished,
    ),
  ).toBe(true);
  departuresBeforeNext(complete);
  expect(
    complete.tour!.history[1].sharing.participants.find(
      (m) => m.actor === 'art-visitor1',
    )!.active,
  ).toBe(false);
  await reset(page);
  expect(logs.get(page)).toEqual([]);
  save('gallery-short-proof', {
    initial,
    first,
    waiting,
    joined,
    directed,
    resumed,
    complete,
  });
});
