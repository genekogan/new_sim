/// <reference types="node" />
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
import type { readComputerWorkshop } from '../engine/activities/computer-workshop.ts';
declare global { interface Window { __marsEngine: EngineHook } }

type Workshop = NonNullable<ReturnType<typeof readComputerWorkshop>>;
// The integration adds this detached observer. No browser source imports or
// private Runtime access: all mutations below are actual visible controls.
type WorkshopHook = EngineHook & { computerWorkshop(): Workshop | null };
const artifacts = path.resolve('e2e/artifacts', process.env.E2E_RUN ?? 'computer-workshop');
const actors = ['facilitator', 'learner-a', 'learner-b'];
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const read = (page: Page) => page.evaluate(() => (window.__marsEngine as WorkshopHook).computerWorkshop()!);
const learner = (w: Workshop, actor = 'learner-a') => w.learners.find(l => l.actor === actor)!;
function station(w: Workshop, actor = 'learner-a') {
  const value = learner(w, actor).workstation;
  expect('code' in value).toBe(false);
  if ('code' in value) throw Error(`${value.code}: ${value.message}`);
  return value;
}
async function start(page: Page) {
  await page.goto('/lab?scenario=computer-workshop');
  await page.waitForFunction(() => window.__marsEngine?.ready);
  expect(await page.evaluate(() => window.__marsEngine.error)).toBe('');
  // Fresh initialization only; meaningful progress always uses actual UI Play.
  await page.evaluate(() => window.__marsEngine.runScenario('computer-workshop', { paused: true, speed: 4 }));
  await expect(page.getByTestId('computer-workshop-hud')).toBeVisible();
  expect(await page.evaluate(() => (window.__marsEngine as WorkshopHook).computerWorkshop())).toBeNull();
  const fixtures = await page.evaluate(() => window.__marsEngine.fixtures().map(f => ({ id: f.id, def: f.def, pose: f.pose, support: f.support })));
  await button(page, 'Start workshop').click();
  const initial = await read(page);
  expect(initial.status).not.toBe('failed');
  expect(initial.bindings.learners.map(l => [l.actor, l.station, l.seat, l.task, l.duration])).toEqual([
    ['learner-a', 'computer-a', 'computer-chair-a#seat', 'Compare prompt variants', 12],
    ['learner-b', 'computer-b', 'computer-chair-b#seat', 'Draft a small image study', 18],
  ]);
  await button(page, 'Play').click();
  return { initial, fixtures };
}
async function partial(page: Page) {
  await page.waitForFunction(() => {
    const w = (window.__marsEngine as WorkshopHook).computerWorkshop();
    return w?.stage === 'practice' && w.learners.every(l => l.child && l.elapsed >= 2 && l.elapsed < 8);
  }, undefined, { timeout: 90_000 });
  await button(page, 'Pause').click();
  const w = await read(page);
  expect(w.stage).toBe('practice');
  expect(w.history.map(h => [h.stage, h.status])).toEqual([['demonstration', 'completed']]);
  expect(w.learners.every(l => l.current?.status === 'executing')).toBe(true);
  return w;
}
async function terminal(page: Page, expected: 'completed' | 'ended') {
  await page.waitForFunction(mode => (window.__marsEngine as WorkshopHook).computerWorkshop()?.mode === mode, expected, { timeout: 120_000 });
  await button(page, 'Pause').click();
  const w = await read(page);
  expect(w.finished).toBe(expected === 'completed');
  expect(w.claims.every(c => c.holders.length === 0)).toBe(true);
  expect(w.records.every(r => r && ['completed', 'cancelled'].includes(r.status))).toBe(true);
  expect(await page.evaluate(() => window.__marsEngine.records().filter(r => !['completed', 'cancelled'].includes(r.status)))).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.slots().filter(s => s.claimedBy !== null))).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.heldItems())).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.state().humans.map(h => [h.id, h.activity, h.task]))).toEqual(actors.map(a => [a, 'idle', null]));
  const fields = await page.evaluate(() => window.__marsEngine.humanFields());
  for (const a of actors) {
    expect(fields[a].hands).toBeNull();
    expect(fields[a].on).toBeNull();
    expect(fields[a].baseActivity).toBeNull();
  }
  expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.state().halted)).toBeNull();
  const tick = await page.evaluate(() => window.__marsEngine.state().tick);
  await button(page, 'Play').click();
  await page.waitForFunction(before => window.__marsEngine.state().tick > before + 20, tick);
  await button(page, 'Pause').click();
  expect((await read(page)).mode).toBe(expected);
  expect((await read(page)).workshop).toBe(w.workshop);
  return w;
}
async function proof(page: Page, info: TestInfo, name: string, observations: Record<string, unknown>) {
  mkdirSync(artifacts, { recursive: true });
  const source = {
    head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    trackedStatus: execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim(),
  };
  const final = await page.evaluate(() => {
    const h = window.__marsEngine as WorkshopHook;
    return { workshop: h.computerWorkshop(), state: h.state(), records: h.records(), slots: h.slots(), held: h.heldItems(), fields: h.humanFields(), fixtures: h.fixtures(), violations: h.violations() };
  });
  const body = JSON.stringify({ source, method: 'actual visible UI Play; no hook stepping or pose/support edits', observations, final }, null, 2);
  writeFileSync(path.join(artifacts, `${name}.json`), body);
  await info.attach(name, { body, contentType: 'application/json' });
  await page.screenshot({ path: path.join(artifacts, `${name}.png`) });
}
async function unchangedFixtures(page: Page, initial: Awaited<ReturnType<typeof start>>) {
  expect(await page.evaluate(() => window.__marsEngine.fixtures().map(f => ({ id: f.id, def: f.def, pose: f.pose, support: f.support })))).toEqual(initial.fixtures);
}

test('computer-workshop: actual Play completes demonstration, independent tasks, review and departure', async ({ page }, info) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  const initial = await start(page);
  await page.waitForFunction(() => (window.__marsEngine as WorkshopHook).computerWorkshop()?.current?.phase === 'presenting');
  await button(page, 'Pause').click();
  const demonstration = await read(page);
  expect(demonstration.current?.presenter).toBe('facilitator');
  await expect(button(page, 'Pause workshop')).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: 'Use global Pause during demonstration/review' })).toBeVisible();
  await button(page, 'Question learner-b').click();
  await button(page, 'Play').click();
  await page.waitForFunction(() => (window.__marsEngine as WorkshopHook).computerWorkshop()?.current?.phase === 'question');
  await button(page, 'Pause').click();
  const question = await read(page);
  expect(question.current?.floorHolder).toBe('learner-b');
  await proof(page, info, 'workshop-demonstration-question', { demonstration, question });
  await button(page, 'Play').click();
  const practice = await partial(page);
  const detached = await page.evaluate(() => {
    const h = window.__marsEngine as WorkshopHook, before = h.computerWorkshop()!, hash = h.stateHash();
    const copy = h.computerWorkshop()!;
    copy.learners[0].elapsed = 999;
    copy.bindings.learners[0].task = 'detached observer mutation';
    copy.members[0].present = false;
    copy.claims[0].holders.push('detached-holder');
    h.cameraPreset('oblique');
    return { before, after: h.computerWorkshop(), hash, afterHash: h.stateHash() };
  });
  expect(detached.after).toEqual(detached.before);
  expect(detached.afterHash).toBe(detached.hash);
  const children = practice.learners.map(l => l.child!);
  expect(children[0]).not.toBe(children[1]);
  for (const l of practice.learners) {
    const s = station(practice, l.actor), binding = practice.bindings.learners.find(p => p.actor === l.actor)!;
    expect(s).toMatchObject({ id: binding.station, user: l.actor, task: binding.task, duration: binding.duration, status: 'active' });
    const seated = await page.evaluate(actor => ({ body: window.__marsEngine.state().humans.find(h => h.id === actor), slots: window.__marsEngine.slots() }), l.actor);
    // HumanState.on denotes a rack link; social seat support is slot occupancy.
    expect(seated.body?.activity).toBe('sit');
    expect(seated.slots.find(s => s.id === binding.seat)?.occupant).toBe(l.actor);
    await expect(page.getByTestId(`learner-${l.actor}`)).toContainText(binding.task!);
  }
  await proof(page, info, 'workshop-distinct-supported-practice', { practice, detached });
  await button(page, 'Play').click();
  await page.waitForFunction(() => {
    const w = (window.__marsEngine as WorkshopHook).computerWorkshop();
    return w?.stage === 'review' && w.current?.phase === 'presenting';
  });
  await button(page, 'Pause').click();
  const review = await read(page);
  expect(review.current?.presenter).toBe('learner-a');
  await expect(button(page, 'Pause workshop')).toBeDisabled();
  expect(review.learners.map(l => [l.elapsed, l.completed])).toEqual([[12, true], [18, true]]);
  await proof(page, info, 'workshop-learner-review', { review });
  await button(page, 'Play').click();
  await page.waitForFunction(() => (window.__marsEngine as WorkshopHook).computerWorkshop()?.current?.groups.some(g => g.status === 'talking'));
  await button(page, 'Pause').click();
  const conversation = await read(page);
  expect(conversation.current?.groups.every(g => g.status === 'talking' && g.floorHolder && g.members.includes(g.floorHolder))).toBe(true);
  await proof(page, info, 'workshop-review-conversation', { conversation });
  await button(page, 'Play').click();
  const complete = await terminal(page, 'completed');
  expect(complete.workshop).toBe(initial.initial.workshop);
  expect(complete.history.map(h => [h.stage, h.status])).toEqual([['demonstration', 'completed'], ['review', 'completed']]);
  expect(complete.learners.map(l => l.actions)).toEqual(children.map(c => [c]));
  for (const l of complete.learners) {
    const binding = complete.bindings.learners.find(p => p.actor === l.actor)!;
    expect(station(complete, l.actor)).toMatchObject({ id: binding.station, task: binding.task, user: l.actor, elapsed: binding.duration, status: 'completed' });
  }
  const humans = await page.evaluate(() => window.__marsEngine.state().humans);
  for (const actor of actors) {
    const destination = complete.bindings.review.departure[actor], person = humans.find(h => h.id === actor)!;
    expect(person.p[0]).toBeCloseTo(destination[0], 2);
    expect(person.p[2]).toBeCloseTo(destination[1], 2);
  }
  await unchangedFixtures(page, initial);
  expect(errors).toEqual([]);
  await proof(page, info, 'workshop-natural-completion', { initial, demonstration, question, practice, review, conversation, complete, errors });
});

test('computer-workshop: individual Pause and ordinary direction retain same task while peer progresses; explicit Join and Resume complete', async ({ page }, info) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  const initial = await start(page), practice = await partial(page);
  const a = learner(practice).child!, b = learner(practice, 'learner-b').child!;
  const elapsed = station(practice).elapsed;
  await button(page, 'Pause learner-a').click();
  await button(page, 'Play').click();
  await page.waitForFunction(() => {
    const w = (window.__marsEngine as WorkshopHook).computerWorkshop();
    return w?.learners[0].paused && !w.learners[0].child;
  });
  await button(page, 'Pause').click();
  const paused = await read(page), peerElapsed = station(paused, 'learner-b').elapsed;
  expect(station(paused).elapsed).toBe(elapsed);
  await expect(button(page, 'Direct learner-a away')).toBeEnabled();
  await button(page, 'Play').click();
  await page.waitForFunction(before => {
    const w = (window.__marsEngine as WorkshopHook).computerWorkshop(), s = w?.learners[1].workstation;
    return s && !('code' in s) && s.elapsed > before + 1;
  }, peerElapsed);
  await button(page, 'Pause').click();
  const independent = await read(page);
  expect(station(independent).elapsed).toBe(elapsed);
  expect(learner(independent, 'learner-b').actions).toEqual([b]);
  await button(page, 'Direct learner-a away').click();
  const direction = await page.evaluate(() => window.__marsEngine.records().filter(r => r.verb === 'walk_to' && !r.parent && r.params.actor === 'learner-a' && r.params.x === -8 && r.params.z === 9).at(-1));
  expect(direction).toBeDefined();
  expect(direction.status).not.toBe('failed');
  await button(page, 'Play').click();
  await page.waitForFunction(id => window.__marsEngine.records().some(r => r.id === id && r.status === 'completed'), direction.id);
  await page.waitForFunction(() => (window.__marsEngine as WorkshopHook).computerWorkshop()?.learners[1].completed);
  await button(page, 'Pause').click();
  const withdrawn = await read(page);
  expect(withdrawn.members.find(m => m.actor === 'learner-a')?.present).toBe(false);
  expect(station(withdrawn).elapsed).toBe(elapsed);
  expect(withdrawn.stage).toBe('practice');
  expect(withdrawn.sessions.review).toBeUndefined();
  await proof(page, info, 'workshop-peer-complete-directed-learner-retained', { practice, paused, independent, direction, withdrawn });
  await button(page, 'Join learner-a').click();
  const join = await page.evaluate(workshop => window.__marsEngine.records().filter(r =>
    r.verb === 'computer_workshop_control' && r.params.workshop === workshop &&
    r.params.intent === 'join' && r.params.actor === 'learner-a').at(-1), withdrawn.workshop);
  expect(join).toBeDefined();
  expect(join.status).not.toBe('failed');
  // Join changes membership at admission, but its ordinary control action must
  // finish on a Play tick before the HUD can accept the next Resume command.
  await button(page, 'Play').click();
  await page.waitForFunction(id => window.__marsEngine.records().some(r => r.id === id && r.status === 'completed'), join.id, { timeout: 15_000 });
  await button(page, 'Pause').click();
  const joined = await read(page);
  expect(joined.members.find(m => m.actor === 'learner-a')?.present).toBe(true);
  expect(learner(joined).paused).toBe(true);
  expect(station(joined).elapsed).toBe(elapsed);
  await expect(button(page, 'Resume learner-a')).toBeEnabled();
  await button(page, 'Resume learner-a').click();
  await button(page, 'Play').click();
  await page.waitForFunction(() => !!(window.__marsEngine as WorkshopHook).computerWorkshop()?.learners[0].child);
  await button(page, 'Pause').click();
  const resumed = await read(page), resumedAction = learner(resumed).child!;
  expect(resumedAction).not.toBe(a);
  expect(learner(resumed).actions).toEqual([a, resumedAction]);
  expect(learner(resumed, 'learner-b').actions).toEqual([b]);
  const resumedRecord = resumed.records.find(r => r?.id === resumedAction)!;
  expect(resumedRecord.params).toMatchObject({ ...resumed.bindings.learners[0], resume: true });
  await button(page, 'Play').click();
  const complete = await terminal(page, 'completed');
  expect(complete.learners.map(l => [l.elapsed, l.completed])).toEqual([[12, true], [18, true]]);
  expect(complete.workshop).toBe(initial.initial.workshop);
  await unchangedFixtures(page, initial);
  expect(errors).toEqual([]);
  await proof(page, info, 'workshop-explicit-same-task-resume-complete', { initial, practice, paused, independent, direction, withdrawn, joined, resumed, complete, errors });
});

test('computer-workshop: local practice Pause retains both tasks; Resume then End drains children and Reset restores fresh supported world', async ({ page }, info) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  const initial = await start(page), practice = await partial(page);
  const elapsed = practice.learners.map(l => station(practice, l.actor).elapsed);
  await button(page, 'Pause workshop').click();
  await button(page, 'Play').click();
  await page.waitForFunction(() => (window.__marsEngine as WorkshopHook).computerWorkshop()?.mode === 'paused');
  await button(page, 'Pause').click();
  const retained = await read(page);
  expect(retained.learners.map(l => station(retained, l.actor).elapsed)).toEqual(elapsed);
  expect(retained.learners.every(l => !l.child)).toBe(true);
  await button(page, 'Resume workshop').click();
  await button(page, 'Play').click();
  await page.waitForFunction(() => (window.__marsEngine as WorkshopHook).computerWorkshop()?.learners.every(l => !!l.child));
  await button(page, 'Pause').click();
  const resumed = await read(page);
  expect(resumed.workshop).toBe(initial.initial.workshop);
  expect(resumed.learners.every((l, i) => l.actions[0] === practice.learners[i].child && l.actions.length === 2)).toBe(true);
  const beforeEnd = resumed.learners.map(l => station(resumed, l.actor).elapsed);
  await button(page, 'End workshop').click();
  await button(page, 'Play').click();
  const ended = await terminal(page, 'ended');
  // End fulfills safe cleanup, not the workshop's declared purpose.
  expect(ended.status).toBe('completed');
  expect(ended.learners.map(l => l.elapsed)).toEqual(beforeEnd);
  expect(ended.learners.every(l => !l.completed)).toBe(true);
  expect(ended.history.map(h => [h.stage, h.status])).toEqual([['demonstration', 'completed']]);
  for (const l of ended.learners) expect(station(ended, l.actor)).toMatchObject({ status: 'unfinished', user: l.actor, task: ended.bindings.learners.find(p => p.actor === l.actor)!.task });
  await unchangedFixtures(page, initial);
  await proof(page, info, 'workshop-ended-retained-unfinished-tasks', { initial, practice, retained, resumed, ended });
  await button(page, 'Reset').click();
  await page.waitForFunction(() => window.__marsEngine.state().tick === 0);
  expect(await page.evaluate(() => (window.__marsEngine as WorkshopHook).computerWorkshop())).toBeNull();
  expect(await page.evaluate(() => window.__marsEngine.records())).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.slots().filter(s => s.claimedBy !== null))).toEqual([]);
  expect(await page.evaluate(() => window.__marsEngine.heldItems())).toEqual([]);
  await unchangedFixtures(page, initial);
  expect(errors).toEqual([]);
  await proof(page, info, 'workshop-reset-fresh-world', { ended, errors });
});
