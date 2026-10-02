/// <reference types="node" />
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
declare global {
  interface Window {
    __marsEngine: EngineHook;
  }
}

// Exactly eight previously stepped/mixed presets. Every physical child and
// meaningful completion below advances by UI Play; Step is readiness only.
const scenarios = [
  'prepared-day-4',
  'prepared-day-8',
  'prepared-day-studio',
  'design-studio',
  'classroom-4',
  'classroom-8',
  'work-break-4',
  'work-break-8',
] as const;
const artifacts = path.resolve(
  'e2e/artifacts',
  process.env.E2E_RUN ?? 'alpha-manual-play',
);
const source = {
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  base: 'b7128256a196cd0a4a9d7eef422e51d3a9e68d39',
  specSha256: createHash('sha256')
    .update(readFileSync(import.meta.filename))
    .digest('hex'),
};
const button = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true });
const terminal = ['completed', 'cancelled'];
async function play(page: Page) {
  if (await page.evaluate(() => window.__marsEngine.state().paused))
    await button(page, 'Play').click();
}
async function freeze(page: Page) {
  if (!(await page.evaluate(() => window.__marsEngine.state().paused)))
    await button(page, 'Pause').click();
}
async function snapshot(page: Page) {
  return page.evaluate(() => {
    const e = window.__marsEngine;
    return {
      state: e.state(),
      epoch: e.scenarioEpoch,
      hash: e.stateHash(),
      example: e.activityExample(),
      classroom: e.classroom(),
      routine: e.purposefulRoutine(),
      continuations: e.gatheringContinuations(),
      workstation: e.workstation(),
      food: e.sharedFood(),
      records: e.records(),
      held: e.heldItems(),
      slots: e.slots(),
      components: e.components(),
      fixtures: e.fixtures(),
      claims: e.garden().claims,
      bones: e.bones(),
      violations: e.violations(),
    };
  });
}
type Evidence = Awaited<ReturnType<typeof snapshot>>;
async function capture(page: Page, scenario: string, label: string) {
  await freeze(page);
  const data = await snapshot(page);
  const actor =
    data.example?.roles.worker ??
    data.classroom.session?.floorHolder ??
    'guest1';
  await page.evaluate((actor) => {
    const e = window.__marsEngine,
      h = e.state().humans.find((h) => h.id === actor);
    if (h) e.camera([h.p[0] + 4, 3.5, h.p[2] + 4], [h.p[0], 0.8, h.p[2]]);
  }, actor);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  mkdirSync(artifacts, { recursive: true });
  const file = path.join(artifacts, `${scenario}-${label}`);
  await page.screenshot({ path: file + '.png' });
  writeFileSync(
    file + '.json',
    JSON.stringify({ source, run: process.env.E2E_RUN, label, data }, null, 2),
  );
  writeFileSync(file + '.a11y.yml', await page.locator('body').ariaSnapshot());
  expect(data.violations).toEqual([]);
  return data;
}
type Stage =
  | 'notes'
  | 'released'
  | 'talks'
  | 'question'
  | 'second'
  | 'groups'
  | 'session-complete'
  | 'worker-seated'
  | 'preparation'
  | 'routine-paused'
  | 'sleep'
  | 'routine-complete'
  | 'continuations'
  | 'food-eating'
  | 'food-complete'
  | 'work-complete';
async function reach(page: Page, stage: Stage) {
  await play(page);
  // The enclosing original120s case budget caps the whole journey, including
  // every wait/capture. This observer never advances ticks or writes authority.
  await page.waitForFunction(
    (stage) => {
      const e = window.__marsEngine,
        r = e.purposefulRoutine(),
        w = e.workstation().state,
        s = e.classroom().session;
      if (e.violations().length) throw Error(JSON.stringify(e.violations()));
      const failed = e.records().filter((r) => r.status === 'failed');
      if (failed.length) throw Error(JSON.stringify(failed));
      switch (stage) {
        case 'notes':
          return !('code' in w) && w.elapsed >= 2;
        case 'released':
          return (
            !('code' in w) &&
            w.status === 'unfinished' &&
            e
              .records()
              .filter((r) => r.verb === 'work_at')
              .at(-1)?.status === 'cancelled'
          );
        case 'talks':
          return (
            s?.phase === 'presenting' &&
            s.presenter ===
              (e.activityExample()?.session.presenters[0] ?? 'presenter1')
          );
        case 'question':
          return (
            s?.phase === 'question' &&
            s.floorHolder === (e.activityExample()?.roles.worker ?? 'guest1')
          );
        case 'second':
          return (
            s?.phase === 'presenting' &&
            s.presenter ===
              (e.activityExample()?.session.presenters[1] ?? 'presenter2')
          );
        case 'groups':
          return (
            s?.phase === 'conversing' &&
            s.groups.length > 0 &&
            s.groups.every(
              (g) =>
                g.status === 'talking' &&
                !!g.floorHolder &&
                g.members.includes(g.floorHolder) &&
                g.attentionTarget?.actor === g.floorHolder,
            )
          );
        case 'session-complete':
          return (
            e
              .records()
              .filter((r) => r.verb === 'classroom_session')
              .at(-1)?.status === 'completed' && s?.phase === 'ended'
          );
        case 'worker-seated':
          return (
            s?.participants.find(
              (p) => p.actor === e.activityExample()?.roles.worker,
            )?.arrival === 'seated'
          );
        case 'preparation':
          return (
            (r?.preparation?.ingredients[0].deposited ?? 0) > 0 &&
            !r?.preparation?.complete
          );
        case 'routine-paused':
          return r?.mode === 'paused';
        case 'sleep':
          return r?.sleep?.mode === 'sleeping' && r.sleep.elapsed >= 1;
        case 'routine-complete':
          return r?.status === 'completed';
        case 'continuations':
          return (
            e.gatheringContinuations().length === 2 &&
            e.gatheringContinuations().every((c) => c?.status === 'completed')
          );
        case 'food-eating':
          return (
            e.sharedFood().at(-1)?.phase === 'eating' &&
            !!e.sharedFood().at(-1)?.floorHolder
          );
        case 'food-complete':
          return e.sharedFood().at(-1)?.status === 'completed';
        case 'work-complete':
          return !('code' in w) && w.status === 'completed' && w.elapsed === 30;
      }
    },
    stage,
    { timeout: 120_000 },
  );
  await freeze(page);
  return snapshot(page);
}
async function action(page: Page, name: string, verb: string) {
  await button(page, name).click();
  const id = await page.evaluate(
    (verb) =>
      window.__marsEngine
        .records()
        .filter((r) => r.verb === verb)
        .at(-1)?.id,
    verb,
  );
  expect(id).toBeTruthy();
  await play(page);
  await page.waitForFunction(
    (id) =>
      ['completed', 'cancelled', 'failed'].includes(
        window.__marsEngine.records().find((r) => r.id === id)?.status ?? '',
      ),
    id,
    { timeout: 120_000 },
  );
  await freeze(page);
  expect(
    await page.evaluate(
      (id) => window.__marsEngine.records().find((r) => r.id === id)?.status,
      id,
    ),
  ).toBe('completed');
}
async function sideLayout(page: Page) {
  for (const item of ['bowl', 'spoon'])
    await action(page, `Take ${item}`, 'take_item');
  await action(page, 'Prepare side layout', 'setup_room');
  expect(
    await page.evaluate(() =>
      window.__marsEngine.fixtures().find((e) => e.id === 'belongings-table'),
    ),
  ).toMatchObject({ support: 'ground', pose: { p: [12, 0, -2] } });
  expect(
    await page.evaluate(() =>
      window.__marsEngine.fixtures().find((e) => e.id === 'seat12'),
    ),
  ).toMatchObject({ support: 'ground', pose: { p: [7.5, 0, 4.5] } });
  await action(page, 'Put belongings away', 'stow_items');
  expect(await page.evaluate(() => window.__marsEngine.heldItems())).toEqual(
    [],
  );
}
async function clean(page: Page, initial: Evidence) {
  await play(page);
  await page.waitForFunction(
    () => {
      const e = window.__marsEngine;
      if (e.violations().length) throw Error(JSON.stringify(e.violations()));
      return (
        e
          .records()
          .every((r) => ['completed', 'cancelled'].includes(r.status)) &&
        e.heldItems().length === 0 &&
        e.slots().every((s) => s.claimedBy === null && s.occupant === null) &&
        Object.values(e.garden().claims).flat().length === 0 &&
        Object.values(e.workstation().claims).flat().length === 0
      );
    },
    undefined,
    { timeout: 120_000 },
  );
  await freeze(page);
  const s = await snapshot(page);
  expect(s.epoch).toBe(initial.epoch);
  expect(s.violations).toEqual([]);
  expect(s.held).toEqual([]);
  expect(
    s.slots.filter((s) => s.claimedBy !== null || s.occupant !== null),
  ).toEqual([]);
  expect(s.records.filter((r) => !terminal.includes(r.status))).toEqual([]);
  expect(Object.values(s.claims).flat()).toEqual([]);
  expect(Object.values(s.workstation.claims).flat()).toEqual([]);
  expect(s.components.map((c) => c.id).sort()).toEqual(
    initial.components.map((c) => c.id).sort(),
  );
  expect(s.fixtures.map((c) => c.id).sort()).toEqual(
    initial.fixtures.map((c) => c.id).sort(),
  );
  for (const h of s.state.humans) {
    expect(h.p.every(Number.isFinite)).toBe(true);
    expect(h.p[1]).toBe(0);
    expect(h.task).toBeNull();
  }
  return s;
}
async function notesThenTalks(page: Page) {
  await button(page, 'Start notes').click();
  const started = await reach(page, 'notes');
  await button(page, 'Interrupt notes').click();
  const stopped = await reach(page, 'released');
  expect(stopped.workstation.state).toMatchObject({
    status: 'unfinished',
    elapsed: !('code' in started.workstation.state)
      ? started.workstation.state.elapsed
      : -1,
  });
  await button(page, 'Start session').click();
  await reach(page, 'talks');
  return stopped;
}
for (const scenario of scenarios) {
  test(`${scenario}: full UI Play supported effects, retained intervention and clean terminal`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    const checkpoints: Record<string, Evidence> = {};
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (e) => {
      if (e.type() === 'error') errors.push(e.text());
    });
    let outcome = 'not-completed';
    try {
      await page.goto(`/lab?scenario=${scenario}`);
      await page.waitForFunction(() => window.__marsEngine?.ready);
      // Healthy fresh loads play automatically; pause through the actual UI
      // before Reset so the first readiness Step is exactly one tick.
      if (await button(page, 'Pause').count())
        await button(page, 'Pause').click();
      await button(page, 'Reset').click();
      await button(page, 'Step').click(); // Exactly one fresh readiness tick; no journey stepping.
      await page
        .getByRole('combobox', { name: 'Speed', exact: true })
        // The eight-guest side-layout journey exceeds120s at4x after its
        // main purpose finishes. Existing UI8x retains every fixed-DT step.
        .selectOption(scenario === 'prepared-day-8' ? '8' : '4');
      const initial = await snapshot(page);
      checkpoints.initial = initial;
      expect(initial.state.scenario).toBe(scenario);
      expect(initial.state.tick).toBe(1);
      expect(initial.records).toEqual([]);
      expect(initial.violations).toEqual([]);
      if (scenario === 'prepared-day-8' || scenario === 'work-break-8')
        await sideLayout(page);
      if (scenario.startsWith('classroom-')) {
        await button(page, 'Start session').click();
        checkpoints.presenting = await reach(page, 'talks');
        await button(page, 'Ask question').click();
        checkpoints.question = await reach(page, 'question');
        expect(
          checkpoints.question.classroom.session?.attentionTarget?.actor,
        ).toBe('guest1');
        await capture(page, scenario, 'question');
        if (scenario === 'classroom-4') {
          await button(page, 'Direct to courtyard').click();
          await play(page);
          await page.waitForFunction(
            () =>
              window.__marsEngine
                .classroom()
                .session?.participants.find((p) => p.actor === 'guest1')
                ?.state === 'excluded',
          );
          await freeze(page);
        }
        await button(page, 'Next presenter').click();
        checkpoints.second = await reach(page, 'second');
        checkpoints.groups = await reach(page, 'groups');
        expect(checkpoints.groups.classroom.session?.groups).toHaveLength(
          scenario === 'classroom-4' ? 2 : 3,
        );
        await capture(page, scenario, 'formed-groups');
        checkpoints.ended = await reach(page, 'session-complete');
      } else {
        checkpoints.unfinished = await notesThenTalks(page);
        const unfinished = checkpoints.unfinished.workstation.state;
        if (scenario.startsWith('work-break-')) {
          await button(page, 'Join session').click();
          checkpoints.seated = await reach(page, 'worker-seated');
          const worker =
            checkpoints.seated.classroom.session?.participants.find(
              (p) => p.actor === 'worker',
            );
          expect(worker?.seat).toBe(
            `seat${scenario.endsWith('-8') ? 12 : 8}#seat`,
          );
          expect(
            checkpoints.seated.slots.find((s) => s.id === worker?.seat)
              ?.occupant,
          ).toBe('worker');
          await button(page, 'Ask question').click();
          checkpoints.question = await reach(page, 'question');
          expect(
            checkpoints.question.classroom.session?.attentionTarget?.actor,
          ).toBe('worker');
          await capture(page, scenario, 'question');
          await reach(page, 'second');
          checkpoints.groups = await reach(page, 'groups');
          expect(
            checkpoints.groups.classroom.session?.groups.some((g) =>
              g.members.includes('worker'),
            ),
          ).toBe(true);
          await capture(page, scenario, 'formed-groups');
          await reach(page, 'session-complete');
          expect(
            await page.evaluate(() => window.__marsEngine.workstation().state),
          ).toEqual(unfinished);
          await button(page, 'Start shared food break').click();
          checkpoints.eating = await reach(page, 'food-eating');
          const food = checkpoints.eating.food.at(-1)!;
          expect(food.participants.map((p) => p.actor)).toContain(
            food.floorHolder,
          );
          expect(
            checkpoints.eating.records.find((r) => r.id === food.group)?.phase,
          ).toBe('talking');
          await expect(button(page, 'Resume notes')).toBeDisabled();
          await capture(page, scenario, 'actual-shared-food');
          checkpoints.food = await reach(page, 'food-complete');
          expect(
            checkpoints.food.food
              .at(-1)
              ?.participants.every(
                (p) =>
                  p.held.length === 0 &&
                  p.returned.length === 2 &&
                  p.food === 0,
              ),
          ).toBe(true);
          expect(checkpoints.food.workstation.state).toEqual(unfinished);
          await button(page, 'Resume notes').click();
          checkpoints.completed = await reach(page, 'work-complete');
          expect(checkpoints.completed.workstation.state).toMatchObject({
            status: 'completed',
            user: 'worker',
            task: 'Sketch notes',
            duration: 30,
            elapsed: 30,
          });
        } else {
          if (scenario === 'design-studio') {
            expect(initial.example?.roles.worker).toBe('project-editor');
            expect(initial.example?.workBreak.work.station).toBe(
              'studio-computer',
            );
            expect(initial.state.humans.some((h) => h.id === 'worker')).toBe(
              false,
            );
          }
          await button(page, 'Start purposeful routine').click();
          await button(page, 'Commit attendee continuations').click();
          if (scenario.startsWith('prepared-day-')) {
            checkpoints.preparation = await reach(page, 'preparation');
            expect(
              checkpoints.preparation.routine?.trip?.participants.every(
                (p) => p.arrived,
              ),
            ).toBe(true);
            expect(
              checkpoints.preparation.routine?.progress.questionAsked,
            ).toBe(true);
            expect(
              checkpoints.preparation.routine?.progress.conversationSeen,
            ).toBe(true);
            expect(checkpoints.preparation.workstation.state).toEqual(
              unfinished,
            );
            await capture(page, scenario, 'actual-preparation');
            if (scenario === 'prepared-day-4') {
              await button(page, 'Pause routine').click();
              checkpoints.paused = await reach(page, 'routine-paused');
              const remembered = checkpoints.paused.routine?.preparation;
              const tick = checkpoints.paused.state.tick;
              await play(page);
              await page.waitForFunction(
                (t) => window.__marsEngine.state().tick >= t + 30,
                tick,
              );
              await freeze(page);
              expect(
                await page.evaluate(
                  () => window.__marsEngine.purposefulRoutine()?.preparation,
                ),
              ).toEqual(remembered);
              await capture(page, scenario, 'retained-preparation');
              await button(page, 'Resume routine').click();
            }
            checkpoints.sleep = await reach(page, 'sleep');
            expect(checkpoints.sleep.routine?.preparation?.complete).toBe(true);
            expect(
              checkpoints.sleep.routine?.progress.meal.every(
                (p) => p.consumed && p.returned,
              ),
            ).toBe(true);
            expect(checkpoints.sleep.held).toEqual([]);
            await capture(page, scenario, 'supported-sleep');
            if (scenario === 'prepared-day-studio') {
              await button(page, 'Pause routine').click();
              checkpoints.paused = await reach(page, 'routine-paused');
              expect(checkpoints.paused.routine?.sleep?.action).toBe(
                checkpoints.sleep.routine?.sleep?.action,
              );
              expect(checkpoints.paused.routine?.sleep?.elapsed).toBe(
                checkpoints.sleep.routine?.sleep?.elapsed,
              );
              expect(
                checkpoints.paused.workstation.claims[
                  `actor:${initial.example!.roles.worker}`
                ],
              ).toEqual([]);
              await capture(page, scenario, 'safe-wake-retained-sleep');
              await button(page, 'Resume routine').click();
            }
          } else {
            checkpoints.question = await reach(page, 'question');
            expect(checkpoints.question.routine?.progress.questionAsked).toBe(
              true,
            );
            await capture(page, scenario, 'actual-critique');
          }
          checkpoints.completed = await reach(page, 'routine-complete');
          expect(checkpoints.completed.routine?.progress.workElapsed).toBe(30);
          expect(
            checkpoints.completed.routine?.progress.meal.every(
              (p) => p.served && p.consumed && p.returned,
            ),
          ).toBe(true);
          if (scenario.startsWith('prepared-day-')) {
            expect(
              checkpoints.completed.routine?.preparation?.ingredients.every(
                (i) => i.deposited === 1,
              ),
            ).toBe(true);
            expect(checkpoints.completed.routine?.sleep?.action).toBe(
              checkpoints.sleep.routine?.sleep?.action,
            );
            expect(checkpoints.completed.routine?.sleep?.remaining).toBe(0);
            expect(checkpoints.completed.routine?.sleep?.elapsed).toBe(18);
          } else
            expect(checkpoints.completed.routine?.progress.restSeconds).toBe(3);
          await capture(page, scenario, 'original-purpose-completed');
          checkpoints.followUps = await reach(page, 'continuations');
          expect(
            checkpoints.followUps.continuations.every(
              (c) => c?.remaining === 0,
            ),
          ).toBe(true);
          const discussion = checkpoints.followUps.continuations.find(
            (c) => c?.bindings.binding.kind === 'discussion',
          );
          const work = checkpoints.followUps.continuations.find(
            (c) => c?.bindings.binding.kind === 'work',
          );
          expect(discussion?.elapsed).toBe(20);
          expect(work?.elapsed).toBe(12);
        }
      }
      checkpoints.clean = await clean(page, initial);
      await capture(page, scenario, 'full-play-terminal');
      expect(errors).toEqual([]);
      await button(page, 'Reset').click();
      await button(page, 'Step').click(); // Reset lifetime readiness only.
      const reset = await snapshot(page);
      checkpoints.reset = reset;
      expect(reset.state.tick).toBe(1);
      expect(reset.records).toEqual([]);
      expect(reset.held).toEqual([]);
      expect(
        reset.slots.filter((s) => s.claimedBy !== null || s.occupant !== null),
      ).toEqual([]);
      expect(reset.routine).toBeUndefined();
      expect(reset.continuations).toEqual([]);
      expect(reset.violations).toEqual([]);
      outcome = 'full-ui-play-completed';
    } finally {
      mkdirSync(artifacts, { recursive: true });
      const final = await snapshot(page).catch(() => null);
      if (outcome !== 'full-ui-play-completed')
        await capture(page, scenario, 'failure-current-state').catch(() => {});
      const receipt = {
        source,
        run: process.env.E2E_RUN,
        scenario,
        outcome,
        nativeStatusAtFinally: testInfo.status,
        checkpoints,
        final,
        errors,
        assertions:
          'original semantic outcomes;120s case/15s expectations/retries0',
        advancement:
          'UI Play only;2UI Step readiness ticks, no hookstep/runToEnd/world mutation',
      };
      const filename = path.join(artifacts, `${scenario}-proof.json`);
      writeFileSync(filename, JSON.stringify(receipt, null, 2));
      await testInfo.attach('alpha-full-ui-play-proof', {
        path: filename,
        contentType: 'application/json',
      });
    }
  });
}
