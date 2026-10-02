/// <reference types="node" />
import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
declare global {
  interface Window {
    __marsEngine: EngineHook;
  }
}
const source = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
const artifacts = path.resolve(
  'e2e/artifacts',
  process.env.E2E_RUN ?? 'creative-vocabulary',
);
const errors = new WeakMap<Page, string[]>();
const button = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true });
async function inspect(page: Page) {
  return page.evaluate(() => ({
    state: window.__marsEngine.state(),
    drawing: window.__marsEngine.drawing(),
    sharing: window.__marsEngine.artSharing(),
    afternoon: window.__marsEngine.creativeAfternoon(),
    book: window.__marsEngine.reading(),
    garden: window.__marsEngine.garden(),
    music: window.__marsEngine.music(),
    jam: window.__marsEngine.openJam(),
    records: window.__marsEngine.records(),
    violations: window.__marsEngine.violations(),
    components: window.__marsEngine.components(),
    fixtures: window.__marsEngine.fixtures(),
    entities: window.__marsEngine.cameraEntities(),
    slots: window.__marsEngine.slots(),
    held: window.__marsEngine.heldItems(),
    hands: window.__marsEngine.humanFields(),
    bones: window.__marsEngine.bones(),
    attention: window.__marsEngine.activityAttentionTargets(),
    audio: window.__marsEngine.musicAudio(),
  }));
}
type Evidence = Awaited<ReturnType<typeof inspect>>;
function drawing(s: Evidence) {
  const d = s.drawing;
  if ('code' in d) throw Error(`${d.code}: ${d.message}`);
  return d;
}
function book(s: Evidence) {
  const b = s.book;
  if ('code' in b) throw Error(`${b.code}: ${b.message}`);
  return b;
}
function save(name: string, evidence: unknown) {
  writeFileSync(
    path.join(artifacts, `${name}.json`),
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
async function capture(page: Page, name: string) {
  await freeze(page);
  const evidence = await inspect(page);
  expect(evidence.violations).toEqual([]);
  await page.screenshot({ path: path.join(artifacts, `${name}.png`) });
  writeFileSync(
    path.join(artifacts, `${name}.a11y.yml`),
    await page.locator('body').ariaSnapshot(),
  );
  save(name, evidence);
  return evidence;
}
async function open(page: Page, scenario: string) {
  mkdirSync(artifacts, { recursive: true });
  const log: string[] = [];
  errors.set(page, log);
  page.on('pageerror', (e) => log.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error') log.push(e.text());
  });
  await page.goto(`/lab?scenario=${scenario}`);
  await page.waitForFunction(() => window.__marsEngine?.ready);
  await page.evaluate(
    (name) => window.__marsEngine.runScenario(name, { paused: true, speed: 4 }),
    scenario,
  );
  await button(page, 'Reset').click();
  await button(page, 'Step').click(); // Only first-tick readiness, never activity execution.
  const initial = await inspect(page);
  expect(initial.state.tick).toBe(1);
  expect(initial.records).toEqual([]);
  expect(initial.violations).toEqual([]);
  return initial;
}
async function reset(page: Page) {
  await button(page, 'Reset').click();
  expect(await page.evaluate(() => window.__marsEngine.records())).toEqual([]);
  await button(page, 'Step').click();
  const s = await inspect(page);
  expect(s.state.tick).toBe(1);
  expect(s.violations).toEqual([]);
  expect(s.audio.active).toBe(0);
}
function clean(s: Evidence) {
  expect(s.violations).toEqual([]);
  expect(s.held).toEqual([]);
  expect(s.slots.filter((v) => v.claimedBy !== null)).toEqual([]);
  expect(s.state.humans.filter((h) => h.task !== null)).toEqual([]);
  expect(Object.values(s.hands).filter((h) => h.hands !== null)).toEqual([]);
  expect(
    s.records.filter(
      (r) => !['completed', 'cancelled', 'failed'].includes(r.status),
    ),
  ).toEqual([]);
}
function sameProps(s: Evidence, initial: Evidence, ids: string[]) {
  const select = (v: Evidence) =>
    v.components
      .filter((c) => ids.includes(c.id))
      .map((c) => [c.id, c.def, c.support, c.pose]);
  expect(select(s)).toEqual(select(initial));
}
function viewing(s: Evidence) {
  expect(s.sharing?.floorHolder).toBeDefined();
  expect(s.sharing?.attentionTarget?.entity).toBe('sketch-pad');
  for (const m of s.sharing!.participants.filter((p) => p.physicallyViewing)) {
    expect(s.attention[m.actor]).toBeDefined();
    expect(s.bones[m.actor]).toBeDefined();
    expect(s.bones[m.actor].activity).toBe(m.speaking ? 'talk' : 'listen');
    expect(Math.abs(Math.min(...s.bones[m.actor].soles))).toBeLessThanOrEqual(
      0.03,
    );
    expect(s.state.humans.find((h) => h.id === m.actor)?.p[1]).toBe(0);
  }
}
test.afterEach(async ({ page }, info) => {
  const name = info.title.startsWith('standalone')
    ? 'art-sharing'
    : 'creative-afternoon';
  save(`${name}-result`, {
    status: info.status,
    errors: info.errors.map((e) => e.message),
    pageErrors: errors.get(page) ?? [],
    state: await inspect(page),
  });
  if (info.status !== info.expectedStatus)
    await capture(page, `${name}-failure`);
});

test('standalone sharing: premade actual pad, physical turns/question-answer/late Join-Leave and explicit Pause-Resume-End', async ({
  page,
}) => {
  const initial = await open(page, 'art-sharing');
  expect(drawing(initial)).toMatchObject({
    ticks: 160,
    status: 'completed',
    totalMarks: 8,
  });
  await expect(page.getByTestId('art-sharing-hud')).toContainText('pre-made');
  await page.evaluate(() =>
    window.__marsEngine.camera([4, 3, -5], [0, 0.8, 0]),
  );
  await button(page, 'Start sharing').click();
  await play(page);
  await page.waitForFunction(() => {
    const s = window.__marsEngine.artSharing();
    return (
      s?.mode === 'sharing' &&
      s.participants.filter((p) => p.active).every((p) => p.physicallyViewing)
    );
  });
  const formed = await capture(page, 'art-sharing-formed-premade-circle');
  viewing(formed);
  expect(
    formed.sharing!.participants.filter((p) => p.physicallyViewing),
  ).toHaveLength(3);
  sameProps(formed, initial, ['sketch-pad', 'sketch-pencil']);
  await button(page, 'Join art-visitor3').click();
  await play(page);
  await page.waitForFunction(
    () =>
      window.__marsEngine
        .artSharing()
        ?.participants.find((p) => p.actor === 'art-visitor3')
        ?.physicallyViewing === true,
  );
  const late = await capture(page, 'art-sharing-late-real-viewer');
  viewing(late);
  expect(
    late.sharing!.participants.filter((p) => p.physicallyViewing),
  ).toHaveLength(4);
  await button(page, 'Leave art-visitor3').click();
  await play(page);
  await page.waitForFunction(() => {
    const h = window.__marsEngine,
      m = h.artSharing()?.participants.find((p) => p.actor === 'art-visitor3');
    return (
      m?.state === 'left' &&
      !!m.departure &&
      h.records().find((r) => r.id === m.departure)?.status === 'completed'
    );
  });
  await freeze(page);
  const left = await inspect(page);
  expect(
    left.sharing!.participants.find((p) => p.actor === 'art-visitor3')!.active,
  ).toBe(false);
  await button(page, 'Ask art-visitor1').click();
  await play(page);
  await page.waitForFunction(() => {
    const s = window.__marsEngine.artSharing();
    return s?.floorHolder === 'art-visitor1' && s.turn.kind === 'question';
  });
  const question = await capture(page, 'art-sharing-question-floor');
  viewing(question);
  await play(page);
  await page.waitForFunction(() => {
    const s = window.__marsEngine.artSharing();
    return (
      s?.pendingQuestion !== undefined &&
      s.participants.find((p) => p.actor === 'art-visitor2')?.physicallyViewing
    );
  });
  await freeze(page);
  const pending = await inspect(page);
  const questionIndex = pending.sharing!.pendingQuestion!;
  expect(pending.sharing!.effects[questionIndex]).toMatchObject({
    actor: 'art-visitor1',
    kind: 'question',
    pad: 'sketch-pad',
    marks: 8,
  });
  await button(page, 'Answer art-visitor2').click();
  await play(page);
  await page.waitForFunction(
    (index) =>
      window.__marsEngine
        .artSharing()
        ?.effects.some(
          (e) =>
            e.actor === 'art-visitor2' &&
            e.kind === 'answer' &&
            e.replyTo === index,
        ),
    questionIndex,
  );
  await freeze(page);
  await button(page, 'Floor sketcher').click();
  await play(page);
  await page.waitForFunction(() => {
    const s = window.__marsEngine.artSharing();
    return s?.floorHolder === 'sketcher' && s.turn.kind === 'comment';
  });
  const answered = await capture(page, 'art-sharing-retained-answer-floor');
  viewing(answered);
  await button(page, 'Pause sharing').click();
  await play(page);
  await page.waitForFunction(
    () => window.__marsEngine.artSharing()?.mode === 'paused',
  );
  const paused = await capture(page, 'art-sharing-safe-pause');
  expect(paused.sharing!.elapsed).toBe(answered.sharing!.elapsed);
  expect(paused.sharing!.effects).toEqual(answered.sharing!.effects);
  expect(
    paused.sharing!.participants.filter((p) => p.physicallyViewing),
  ).toEqual([]);
  expect(paused.slots.filter((s) => s.claimedBy !== null)).toEqual([]);
  await button(page, 'Resume sharing').click();
  await play(page);
  await page.waitForFunction(
    () => window.__marsEngine.artSharing()?.mode === 'sharing',
  );
  await freeze(page);
  const resumed = await inspect(page);
  expect(resumed.sharing!.session).toBe(paused.sharing!.session);
  expect(resumed.sharing!.elapsed).toBeGreaterThanOrEqual(
    paused.sharing!.elapsed,
  );
  expect(
    resumed.sharing!.effects.slice(0, paused.sharing!.effects.length),
  ).toEqual(paused.sharing!.effects);
  await button(page, 'End sharing').click();
  await play(page);
  await page.waitForFunction(
    () => window.__marsEngine.artSharing()?.mode === 'completed',
  );
  const ended = await capture(page, 'art-sharing-explicit-end-retained-pad');
  clean(ended);
  expect(ended.sharing!.finished).toBe(false);
  await expect(page.getByTestId('art-sharing-readout')).toContainText(
    'cancelled · ended',
  );
  expect(
    ended
      .sharing!.participants.filter((p) => p.active)
      .every((p) => p.state === 'ended'),
  ).toBe(true);
  expect(drawing(ended).completedMarks).toEqual(
    drawing(initial).completedMarks,
  );
  sameProps(ended, initial, ['sketch-pad', 'sketch-pencil']);
  await reset(page);
  expect(
    await page.evaluate(() => window.__marsEngine.artSharing()),
  ).toBeNull();
  expect(errors.get(page)).toEqual([]);
  save('art-sharing-proof', {
    initial,
    formed,
    late,
    left,
    question,
    pending,
    answered,
    paused,
    resumed,
    ended,
  });
});

test('connected creative afternoon: actual drawn partial artifact, independent retained reader/care, physical music exchange and same-pad return', async ({
  page,
}) => {
  const initial = await open(page, 'creative-afternoon');
  expect(drawing(initial)).toMatchObject({
    ticks: 0,
    status: 'idle',
    completedMarks: [],
  });
  await expect(button(page, 'Start sharing')).toHaveCount(0);
  await page.evaluate(() =>
    window.__marsEngine.camera([4, 3, -5], [0, 0.8, 0]),
  );
  await button(page, 'Start creative afternoon').click();
  await play(page);
  // The reader's first four-second slice finishes before a reliable joint
  // artist/reader observation window. Pause it early through the actual HUD.
  await page.waitForFunction(() => {
    const b = window.__marsEngine.reading();
    return !('code' in b) && b.elapsed >= 1 && b.elapsed < 2;
  });
  await freeze(page);
  await button(page, 'Pause reader').click();
  await play(page);
  await page.waitForFunction(() => {
    const d = window.__marsEngine.drawing(),
      afternoon = window.__marsEngine.creativeAfternoon();
    return (
      afternoon?.commitments.find((c) => c?.actor === 'reader')?.mode ===
        'paused' &&
      !('code' in d) &&
      d.ticks >= 22 &&
      d.ticks < 50
    );
  });
  const partial = await capture(page, 'creative-actual-partial-artist-reader');
  expect(
    partial.held.some((v) => v.id === 'sketch-pencil' && v.by === 'sketcher'),
  ).toBe(true);
  expect(drawing(partial).completedMarks.length).toBeGreaterThan(0);
  expect(book(partial).elapsed).toBeGreaterThan(0);
  expect(book(partial).elapsed).toBeLessThan(4);
  await button(page, 'Direct artist away').click();
  await play(page);
  await page.waitForFunction(() => {
    const h = window.__marsEngine,
      d = h.creativeAfternoon(),
      direction = h
        .records()
        .filter(
          (r) =>
            r.verb === 'walk_to' &&
            !r.parent &&
            (r.params as { actor?: string }).actor === 'sketcher',
        )
        .at(-1);
    return (
      d?.intention?.mode === 'paused' &&
      d.commitments.find((c) => c?.actor === 'reader')?.mode === 'paused' &&
      direction?.status === 'completed'
    );
  });
  const stopped = await capture(
    page,
    'creative-directed-artist-independent-reader-paused',
  );
  expect(drawing(stopped)).toMatchObject({
    status: 'unfinished',
    ticks: drawing(partial).ticks,
    completedMarks: drawing(partial).completedMarks,
    activeMark: drawing(partial).activeMark,
  });
  expect(book(stopped).elapsed).toBe(book(partial).elapsed);
  const plantBefore = stopped.garden.plants[0];
  if ('code' in plantBefore) throw Error(plantBefore.message);
  await play(page);
  await page.waitForFunction(() => {
    const g = window.__marsEngine.garden().plants[0];
    return !('code' in g) && g.cycles === 1;
  });
  const independent = await capture(
    page,
    'creative-garden-finishes-while-two-purposes-paused',
  );
  expect(book(independent).elapsed).toBe(book(stopped).elapsed);
  expect(drawing(independent).ticks).toBe(drawing(stopped).ticks);
  expect(
    independent.afternoon!.commitments.find((c) => c?.actor === 'carer')!.mode,
  ).not.toBe('paused');
  await button(page, 'Resume reader').click();
  await play(page);
  await page.waitForFunction(
    () =>
      window.__marsEngine
        .creativeAfternoon()
        ?.commitments.find((c) => c?.actor === 'reader')?.mode !== 'paused',
  );
  await freeze(page);
  await button(page, 'Resume artist commitment').click();
  await play(page);
  await page.waitForFunction(
    () =>
      window.__marsEngine.creativeAfternoon()?.phase === 'sharing' &&
      window.__marsEngine.artSharing()?.mode === 'sharing',
  );
  const shared = await capture(page, 'creative-three-actual-marks-sharing');
  viewing(shared);
  expect(drawing(shared)).toMatchObject({
    ticks: 60,
    status: 'unfinished',
    totalMarks: 8,
  });
  expect(drawing(shared).completedMarks).toHaveLength(3);
  expect(shared.sharing!.artifact!.marks).toEqual(
    drawing(shared).completedMarks,
  );
  sameProps(shared, initial, ['sketch-pad', 'sketch-pencil', 'book']);
  await play(page);
  await page.waitForFunction(() => {
    const d = window.__marsEngine.creativeAfternoon(),
      m = window.__marsEngine.music()?.station;
    return (
      d?.phase === 'music' &&
      d.jam?.index === 0 &&
      !!m &&
      !('code' in m) &&
      m.phase === 'working' &&
      m.elapsed >= 1
    );
  });
  await freeze(page);
  await page.evaluate(() =>
    window.__marsEngine.camera([11, 4, -4], [7, 0.8, 3]),
  );
  const musicFirst = await capture(
    page,
    'creative-artist-first-real-computer-score',
  );
  expect(
    musicFirst.slots.find((s) => s.id === 'music-chair#seat')?.occupant,
  ).toBe('sketcher');
  expect(drawing(musicFirst).ticks).toBe(60);
  await play(page);
  await page.waitForFunction(() => {
    const d = window.__marsEngine.creativeAfternoon(),
      m = window.__marsEngine.music()?.station;
    return (
      d?.phase === 'music' &&
      d.jam?.index === 1 &&
      !!m &&
      !('code' in m) &&
      m.phase === 'working' &&
      m.elapsed >= 1
    );
  });
  const musicSecond = await capture(
    page,
    'creative-second-performer-same-station',
  );
  expect(
    musicSecond.slots.find((s) => s.id === 'music-chair#seat')?.occupant,
  ).toBe('guest-musician');
  expect(
    musicSecond.fixtures
      .filter((f) => ['music-computer', 'music-chair'].includes(f.id))
      .map((f) => [f.id, f.def, f.pose, f.support]),
  ).toEqual(
    initial.fixtures
      .filter((f) => ['music-computer', 'music-chair'].includes(f.id))
      .map((f) => [f.id, f.def, f.pose, f.support]),
  );
  expect(musicSecond.afternoon!.jam!.finished[0]).toMatchObject({
    actor: 'sketcher',
    playedSeconds: 7,
  });
  await play(page);
  await page.waitForFunction(() => {
    const d = window.__marsEngine.creativeAfternoon(),
      a = window.__marsEngine.drawing();
    return (
      d?.phase === 'return' && !('code' in a) && a.ticks > 60 && a.ticks < 150
    );
  });
  await freeze(page);
  await page.evaluate(() =>
    window.__marsEngine.camera([2.5, 2.6, -3], [0, 0.8, -0.3]),
  );
  const returning = await capture(
    page,
    'creative-ordinary-return-same-pad-pencil',
  );
  expect(drawing(returning).completedMarks.slice(0, 3)).toEqual(
    drawing(shared).completedMarks,
  );
  expect(
    returning.held.some((v) => v.id === 'sketch-pencil' && v.by === 'sketcher'),
  ).toBe(true);
  await play(page);
  await page.waitForFunction(
    () => window.__marsEngine.creativeAfternoon()?.phase === 'completed',
  );
  await freeze(page);
  await page.evaluate(() =>
    window.__marsEngine.camera([-0.15, 1.5, -0.15], [-0.15, 0.765, -0.3]),
  );
  const complete = await capture(page, 'creative-complete-same-eight-mark-pad');
  clean(complete);
  expect(drawing(complete)).toMatchObject({
    ticks: 160,
    status: 'completed',
    pencil: drawing(shared).pencil,
    user: drawing(shared).user,
  });
  expect(drawing(complete).completedMarks).toHaveLength(8);
  expect(book(complete)).toMatchObject({
    id: 'book',
    status: 'completed',
    elapsed: 20,
  });
  const plant = complete.garden.plants[0];
  if ('code' in plant) throw Error(plant.message);
  expect(plant).toMatchObject({
    plant: 'plant-a',
    cycles: 1,
    waterReceived: 0.25,
  });
  expect(complete.garden.water.contents?.fraction).toBe(0.75);
  sameProps(complete, initial, [
    'sketch-pad',
    'sketch-pencil',
    'book',
    'water-bowl',
  ]);
  expect(complete.entities.map((e) => e.id).sort()).toEqual(
    initial.entities.map((e) => e.id).sort(),
  );
  const jamRecord = complete.records
    .slice()
    .reverse()
    .find((r) => r.verb === 'open_jam');
  expect(jamRecord?.status).toBe('completed');
  expect(
    complete.records.filter(
      (r) => r.verb === 'computer_music' && r.status === 'completed',
    ),
  ).toHaveLength(2);
  expect(
    complete.afternoon!.commitments.every((c) => c?.mode === 'completed'),
  ).toBe(true);
  await reset(page);
  expect(
    await page.evaluate(() => window.__marsEngine.creativeAfternoon()),
  ).toBeNull();
  expect(drawing(await inspect(page)).ticks).toBe(0);
  expect(errors.get(page)).toEqual([]);
  save('creative-afternoon-proof', {
    initial,
    partial,
    stopped,
    independent,
    shared,
    musicFirst,
    musicSecond,
    returning,
    complete,
  });
});
