/// <reference types="node" />
import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
import type { readReadingCircle } from '../engine/activities/reading-circle.ts';
declare global {
  interface Window {
    __marsEngine: EngineHook;
  }
}
type CircleHook = EngineHook & {
  readingCircle: () => ReturnType<typeof readReadingCircle> | null;
};
const source = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
  directory = path.resolve(
    'e2e/artifacts',
    process.env.E2E_RUN ?? 'reading-circle',
  );
const errors = new WeakMap<Page, string[]>();
const button = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true });
async function inspect(page: Page) {
  return page.evaluate(() => {
    const h = window.__marsEngine as CircleHook;
    return {
      state: h.state(),
      circle: h.readingCircle(),
      book: h.reading(),
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
      activity: h.cameraActivityReadout(),
      audio: h.musicAudio(),
    };
  });
}
type Evidence = Awaited<ReturnType<typeof inspect>>;
function book(s: Evidence) {
  if ('code' in s.book) throw Error(`${s.book.code}: ${s.book.message}`);
  return s.book;
}
function save(name: string, data: unknown) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, `${name}.json`),
    JSON.stringify({ source, run: process.env.E2E_RUN, data }, null, 2),
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
async function reset(page: Page) {
  await button(page, 'Reset').click();
  expect(await page.evaluate(() => window.__marsEngine.records())).toEqual([]);
  await button(page, 'Step').click(); // Only fresh first-tick readiness; activities advance through actual Play.
  const s = await inspect(page);
  expect(s.state.tick).toBe(1);
  expect(s.circle).toBeNull();
  expect(book(s)).toMatchObject({ status: 'idle', elapsed: 0, page: 1 });
  expect(s.violations).toEqual([]);
  expect(s.audio.active).toBe(0);
}
async function open(page: Page, scenario: string) {
  mkdirSync(directory, { recursive: true });
  const log: string[] = [];
  errors.set(page, log);
  page.on('pageerror', (e) => log.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error') log.push(e.text());
  });
  await page.goto(`/lab?scenario=${scenario}`);
  await page.waitForFunction(() => window.__marsEngine?.ready);
  await page.evaluate(
    (name) => window.__marsEngine.runScenario(name, { paused: true, speed: 2 }),
    scenario,
  );
  await reset(page);
  await expect(page.getByTestId('reading-circle-hud')).toContainText(
    'Hypothetical supported',
  );
  await page.evaluate(() => {
    const b = window.__marsEngine.components().find((c) => c.id === 'book')!;
    window.__marsEngine.camera(
      [b.pose.p[0] + 3, b.pose.p[1] + 2.4, b.pose.p[2] - 4],
      b.pose.p,
    );
  });
  return inspect(page);
}
function sameBook(s: Evidence, initial: Evidence) {
  // The book's secondary page turn and moving bookmark intentionally change
  // rendered bounds. Compare exact authoritative geometry, not animated details.
  const physical = (components: Evidence['components']) =>
    components.map(({ rendered, ...component }) => {
      expect(rendered).not.toBeNull();
      expect([...rendered!.min, ...rendered!.max].every(Number.isFinite)).toBe(
        true,
      );
      return component;
    });
  expect(physical(s.components)).toEqual(physical(initial.components));
  expect(s.fixtures).toEqual(initial.fixtures);
  expect(s.entities.map((e) => e.id).sort()).toEqual(
    initial.entities.map((e) => e.id).sort(),
  );
  expect(s.circle!.artifact!.id).toBe('book');
  expect(s.circle!.artifact!.pose).toEqual(
    initial.components.find((c) => c.id === 'book')!.pose,
  );
  expect(s.circle!.artifact!.support).toEqual({
    kind: initial.components.find((c) => c.id === 'book')!.support,
    on: 'reading-table',
    slot: 'r0c2',
  });
}
function listening(s: Evidence) {
  expect(s.circle!.attentionTarget?.entity).toBe('book');
  for (const m of s.circle!.participants.filter((m) => m.active)) {
    expect(m.state).toMatch(/listening|speaking/);
    expect(s.attention[m.actor]).toBeDefined();
    expect(s.bones[m.actor].activity).toBe(
      m.state === 'speaking' ? 'talk' : 'listen',
    );
    expect(Math.abs(Math.min(...s.bones[m.actor].soles))).toBeLessThanOrEqual(
      0.03,
    );
    expect(s.state.humans.find((h) => h.id === m.actor)?.p[1]).toBe(0);
  }
}
function seatedReading(s: Evidence) {
  expect(book(s).phase).toBe('reading');
  expect(s.circle!.floorHolder).toBe('reader');
  expect(s.slots.find((v) => v.id === 'reading-chair#seat')?.occupant).toBe(
    'reader',
  );
  // bones.on describes an elevated rack link, not chair support. Prove the
  // actual occupied seat, owned sit child and rendered seated posture instead.
  const seat = s.slots.find((v) => v.id === 'reading-chair#seat')!;
  expect(seat).toMatchObject({
    state: 'occupied',
    claimant: 'reader',
    claimedBy: book(s).action,
  });
  const reader = s.state.humans.find((h) => h.id === 'reader')!;
  const sit = s.records.find((r) => r.id === reader.task)!;
  expect(sit).toMatchObject({
    verb: 'sit',
    parent: book(s).action,
    status: 'executing',
    phase: 'occupied',
    params: { actor: 'reader', slot: 'reading-chair#seat' },
  });
  expect(reader.activity).toBe('sit');
  expect([reader.p[0], reader.p[2]]).toEqual(seat.p);
  expect(s.bones.reader).toMatchObject({
    activity: 'sit',
    base: 'sit',
    walkW: 0,
  });
  // Existing camp-chair fabric height .44m + seated pelvis offset .09m.
  expect(s.bones.reader.hipY).toBeCloseTo(0.53, 4);
  expect(Math.abs(Math.min(...s.bones.reader.soles))).toBeLessThanOrEqual(0.03);
  expect(s.attention.reader).toBeDefined();
  listening(s);
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
async function controlsDone(page: Page) {
  await play(page);
  await page.waitForFunction(
    () =>
      !window.__marsEngine
        .records()
        .some(
          (r) =>
            r.verb === 'reading_circle_control' &&
            !['completed', 'cancelled', 'failed'].includes(r.status),
        ),
  );
  await freeze(page);
}
test.afterEach(async ({ page }, info) => {
  const name = info.title.startsWith('default')
    ? 'reading-circle-default'
    : 'reading-circle-rotated';
  save(`${name}-result`, {
    status: info.status,
    errors: info.errors.map((e) => e.message),
    pageErrors: errors.get(page) ?? [],
    state: await inspect(page),
  });
  if (info.status !== info.expectedStatus)
    await capture(page, `${name}-failure`, false);
});

test('default actual Play: exact partial bookmark Pause-Resume, declared Join-Leave, real question-answer and reader direction then complete', async ({
  page,
}) => {
  const initial = await open(page, 'reading-circle');
  await button(page, 'Start shared reading').click();
  await play(page);
  await page.waitForFunction(() => {
    const b = window.__marsEngine.reading();
    return (
      !('code' in b) && b.phase === 'reading' && b.elapsed >= 1 && b.elapsed < 3
    );
  });
  const partial = await capture(page, 'reading-circle-default-seated-partial');
  seatedReading(partial);
  sameBook(partial, initial);
  expect(book(partial).user).toBe('reader');
  await button(page, 'Pause circle').click();
  await play(page);
  await page.waitForFunction(
    () =>
      (window.__marsEngine as CircleHook).readingCircle()?.mode === 'paused',
  );
  const paused = await capture(
    page,
    'reading-circle-default-safe-bookmark-pause',
  );
  expect(book(paused)).toMatchObject({
    status: 'unfinished',
    elapsed: book(partial).elapsed,
    page: book(partial).page,
    user: 'reader',
    task: book(partial).task,
  });
  expect(paused.circle!.effects).toEqual(partial.circle!.effects);
  expect(paused.slots.filter((s) => s.claimedBy !== null)).toEqual([]);
  sameBook(paused, initial);
  await button(page, 'Join listener-3').click();
  await controlsDone(page);
  await button(page, 'Resume circle').click();
  await play(page);
  await page.waitForFunction(() => {
    const h = window.__marsEngine as CircleHook,
      s = h.readingCircle(),
      b = h.reading();
    return (
      s?.participants.find((p) => p.actor === 'listener-3')?.state ===
        'listening' &&
      !('code' in b) &&
      b.phase === 'reading'
    );
  });
  const late = await capture(
    page,
    'reading-circle-default-declared-late-listener',
  );
  seatedReading(late);
  expect(late.circle!.participants.filter((m) => m.active)).toHaveLength(3);
  expect(late.circle!.session).toBe(paused.circle!.session);
  expect(book(late).elapsed).toBeGreaterThanOrEqual(book(paused).elapsed);
  await button(page, 'Ask listener-3').click();
  await play(page);
  await page.waitForFunction(() => {
    const s = (window.__marsEngine as CircleHook).readingCircle();
    return (
      s?.pendingQuestion !== undefined &&
      s.floorHolder === 'reader' &&
      s.turn.kind === 'answer'
    );
  });
  const question = await capture(
    page,
    'reading-circle-default-actual-question-answer-floor',
  );
  listening(question);
  const qi = question.circle!.pendingQuestion!;
  expect(question.circle!.effects[qi]).toMatchObject({
    book: 'book',
    actor: 'listener-3',
    kind: 'question',
  });
  expect(question.circle!.effects[qi].readSeconds).toBe(book(question).elapsed);
  await button(page, 'Answer listener-2').click();
  await play(page);
  await page.waitForFunction(
    (q) =>
      (window.__marsEngine as CircleHook)
        .readingCircle()
        ?.effects.some(
          (e) =>
            e.actor === 'listener-2' && e.kind === 'answer' && e.replyTo === q,
        ),
    qi,
  );
  await freeze(page);
  const answered = await inspect(page);
  expect(
    answered.circle!.effects.some(
      (e) =>
        e.actor === 'listener-2' && e.kind === 'answer' && e.replyTo === qi,
    ),
  ).toBe(true);
  // Recording the answer precedes ordinary floor-release/reoccupation. Let
  // that physical transition finish before asking an eligible listener to speak.
  await play(page);
  await expect(button(page, 'Floor listener-1')).toBeEnabled();
  await button(page, 'Floor listener-1').click();
  await controlsDone(page);
  await play(page);
  await expect(button(page, 'Leave listener-3')).toBeEnabled();
  await button(page, 'Leave listener-3').click();
  await play(page);
  await page.waitForFunction(() => {
    const h = window.__marsEngine as CircleHook,
      m = h.readingCircle()?.participants.find((p) => p.actor === 'listener-3');
    return (
      m?.active === false &&
      !!m.departure &&
      h.records().find((r) => r.id === m.departure)?.status === 'completed'
    );
  });
  await freeze(page);
  const beforeDirection = await inspect(page);
  expect(book(beforeDirection).elapsed).toBeLessThan(12);
  await button(page, 'Direct reader away').click();
  await play(page);
  await page.waitForFunction(() => {
    const h = window.__marsEngine as CircleHook,
      r = h
        .records()
        .filter(
          (r) =>
            r.verb === 'walk_to' &&
            !r.parent &&
            (r.params as { actor?: string }).actor === 'reader',
        )
        .at(-1);
    return h.readingCircle()?.mode === 'waiting' && r?.status === 'completed';
  });
  const directed = await capture(
    page,
    'reading-circle-default-directed-reader-bookmark',
  );
  expect(directed.circle!.diagnostic?.code).toBe(
    'reading_circle.reader-directed',
  );
  expect(book(directed).elapsed).toBe(book(beforeDirection).elapsed);
  expect(book(directed).page).toBe(book(beforeDirection).page);
  expect(directed.circle!.effects).toEqual(beforeDirection.circle!.effects);
  expect(
    directed.circle!.participants.find((m) => m.actor === 'listener-3')!.active,
  ).toBe(false);
  await button(page, 'Resume circle').click();
  await play(page);
  await page.waitForFunction(
    () =>
      (window.__marsEngine as CircleHook).readingCircle()?.mode ===
        'completed' &&
      (window.__marsEngine as CircleHook).readingCircle()?.finished === true,
  );
  const complete = await capture(
    page,
    'reading-circle-default-completed-same-book',
  );
  clean(complete);
  sameBook(complete, initial);
  expect(book(complete)).toMatchObject({
    id: 'book',
    status: 'completed',
    elapsed: 12,
    duration: 12,
    page: 4,
    user: 'reader',
    task: book(partial).task,
  });
  expect(complete.circle!.session).toBe(partial.circle!.session);
  expect(
    complete.circle!.effects.slice(0, answered.circle!.effects.length),
  ).toEqual(answered.circle!.effects);
  expect(complete.circle!.effects.every((e) => e.book === 'book')).toBe(true);
  expect(
    complete.circle!.effects.some(
      (e) => e.actor === 'listener-1' && e.kind === 'comment',
    ),
  ).toBe(true);
  expect(
    complete.circle!.participants.find((m) => m.actor === 'listener-3')!.active,
  ).toBe(false);
  await reset(page);
  expect(errors.get(page)).toEqual([]);
  save('reading-circle-default-proof', {
    initial,
    partial,
    paused,
    late,
    question,
    answered,
    beforeDirection,
    directed,
    complete,
  });
});

test('rotated actual Play: End partial retains page/effects, explicit same-book new circle starts at exact bookmark and completes', async ({
  page,
}) => {
  const initial = await open(page, 'reading-circle-rotated');
  await button(page, 'Start shared reading').click();
  await play(page);
  await page.waitForFunction(() => {
    const h = window.__marsEngine as CircleHook,
      b = h.reading(),
      s = h.readingCircle();
    return (
      !('code' in b) &&
      b.phase === 'reading' &&
      b.elapsed >= 5 &&
      b.elapsed < 7 &&
      (s?.effects.length ?? 0) >= 2
    );
  });
  const partial = await capture(
    page,
    'reading-circle-rotated-partial-after-real-discussion',
  );
  seatedReading(partial);
  sameBook(partial, initial);
  expect(partial.circle!.effects.some((e) => e.kind === 'question')).toBe(true);
  expect(partial.circle!.effects.some((e) => e.kind === 'answer')).toBe(true);
  await button(page, 'End circle').click();
  await play(page);
  await page.waitForFunction(
    () =>
      (window.__marsEngine as CircleHook).readingCircle()?.mode === 'completed',
  );
  const ended = await capture(
    page,
    'reading-circle-rotated-ended-exact-bookmark',
  );
  clean(ended);
  sameBook(ended, initial);
  expect(ended.circle!.finished).toBe(false);
  expect(ended.circle!.status).toBe('cancelled');
  expect(book(ended)).toMatchObject({
    status: 'unfinished',
    elapsed: book(partial).elapsed,
    page: book(partial).page,
    user: 'reader',
    task: book(partial).task,
  });
  expect(ended.circle!.effects).toEqual(partial.circle!.effects);
  await button(page, 'Resume unfinished book').click();
  const admission = await inspect(page);
  expect(admission.circle!.session).not.toBe(ended.circle!.session);
  expect(admission.circle!.bindings.resume).toBe(true);
  expect(admission.circle!.elapsed).toBe(book(ended).elapsed);
  expect(book(admission).elapsed).toBe(book(ended).elapsed);
  expect(book(admission).page).toBe(book(ended).page);
  await play(page);
  await page.waitForFunction((elapsed) => {
    const b = window.__marsEngine.reading();
    return (
      !('code' in b) && b.phase === 'reading' && b.elapsed >= elapsed + 0.5
    );
  }, book(ended).elapsed);
  const restarted = await capture(
    page,
    'reading-circle-rotated-restarted-same-reader-page',
  );
  seatedReading(restarted);
  sameBook(restarted, initial);
  expect(book(restarted).elapsed).toBeGreaterThan(book(ended).elapsed);
  expect(book(restarted).page).toBeGreaterThanOrEqual(book(ended).page);
  await expect(page.getByTestId('reading-circle-prior')).toContainText(
    ended.circle!.session,
  );
  await play(page);
  await page.waitForFunction(
    () =>
      (window.__marsEngine as CircleHook).readingCircle()?.mode ===
        'completed' &&
      (window.__marsEngine as CircleHook).readingCircle()?.finished === true,
  );
  const complete = await capture(
    page,
    'reading-circle-rotated-completed-clean',
  );
  clean(complete);
  sameBook(complete, initial);
  expect(book(complete)).toMatchObject({
    id: 'book',
    status: 'completed',
    elapsed: 12,
    duration: 12,
    page: 4,
    user: 'reader',
    task: book(partial).task,
  });
  expect(complete.circle!.status).toBe('completed');
  expect(
    complete.records.find((r) => r.id === ended.circle!.session)?.outputs
      .effects,
  ).toEqual(ended.circle!.effects);
  expect(
    complete.records.filter((r) => r.verb === 'reading_circle'),
  ).toHaveLength(2);
  await reset(page);
  expect(errors.get(page)).toEqual([]);
  save('reading-circle-rotated-proof', {
    initial,
    partial,
    ended,
    admission,
    restarted,
    complete,
  });
});
