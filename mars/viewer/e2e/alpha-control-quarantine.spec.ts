/// <reference types="node" />
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
type QuarantineWindow = { __marsEngine: EngineHook };
const source = {
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  base: '33c7a06eda783d997b5b73595446f80df3bc9cb6',
  specSha256: createHash('sha256')
    .update(readFileSync(import.meta.filename))
    .digest('hex'),
};
const artifacts = path.resolve(
  'e2e/artifacts',
  process.env.E2E_RUN ?? 'alpha-control-quarantine',
);
async function frozen(page: Page) {
  return page.evaluate(() => {
    const e = (window as unknown as QuarantineWindow).__marsEngine,
      info = e.info();
    return {
      hash: e.stateHash(),
      tick: e.state().tick,
      records: e.records(),
      violations: e.violations(),
      log: e.log(),
      diagnostics: e.sequence().diagnostics,
      claims: e.garden().claims,
      geometries: info.geometries,
      textures: info.textures,
      speed: e.state().speed,
      paused: e.state().paused,
    };
  });
}

test('alpha quarantine: actual Lab activity controls and every hook mutator preserve halted authority until Reset', async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  await page.goto('/lab?scenario=classroom-4');
  await page.waitForFunction(
    () => (window as unknown as QuarantineWindow).__marsEngine?.ready,
  );
  if (
    !(await page.evaluate(
      () => (window as unknown as QuarantineWindow).__marsEngine.state().paused,
    ))
  )
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
  // Deliberate test-only invariant: this is a quarantine fixture, never a
  // production scenario failure. It uses the real loaded controller and panel.
  await page.evaluate(async () => {
    const modulePath = '/app/lab/scenarios.ts';
    const m = (await import(
      modulePath
    )) as typeof import('../app/lab/scenarios.ts');
    const s = m.scenarioByName('classroom-4')!;
    const original = { ...s };
    let contained = false;
    s.admission = (rt) => {
      if (contained) throw new Error('fixture.quarantine-admission-reentry');
      return original.admission?.(rt) ?? null;
    };
    s.hud = (rt) => {
      if (contained) throw new Error('fixture.quarantine-hud-reentry');
      return original.hud?.(rt) ?? [];
    };
    const fixtureWindow = window as unknown as {
      restoreQuarantineFixture?: () => void;
    };
    fixtureWindow.restoreQuarantineFixture = () => {
      if (original.build) s.build = original.build;
      else delete s.build;
      if (original.admission) s.admission = original.admission;
      else delete s.admission;
      if (original.hud) s.hud = original.hud;
      else delete s.hud;
    };
    s.build = () => {
      const rt = m.buildRuntime(original);
      rt.invariants = [
        ...rt.invariants,
        () => {
          contained = true;
          const session = [...rt.records.values()].find(
            (r) => r.verb === 'classroom_session',
          );
          const classrooms = rt.services.classroomActivities as
            | Record<
                string,
                { error?: import('../engine/actions/types.ts').Diagnostic }
              >
            | undefined;
          if (session && classrooms?.[session.id])
            classrooms[session.id].error = {
              code: 'fixture.classroom-diagnostic',
              message: 'Test-only retained classroom error',
              subjects: ['presenter1'],
            };
          return [
            {
              code: 'fixture.control-quarantine',
              message: 'Deliberate test-only invariant quarantine',
              subjects: ['presenter1'],
            },
          ];
        },
      ];
      return rt;
    };
  });
  const checkpoints: Record<string, unknown> = {};
  try {
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.waitForFunction(
      () =>
        (window as unknown as QuarantineWindow).__marsEngine.ready &&
        (window as unknown as QuarantineWindow).__marsEngine.state().tick === 0,
    );
    await expect(
      page.getByRole('button', { name: 'Start session', exact: true }),
    ).toBeEnabled();
    await page
      .getByRole('button', { name: 'Start session', exact: true })
      .click();
    expect(
      await page.evaluate(() =>
        (window as unknown as QuarantineWindow).__marsEngine
          .records()
          .some((r) => r.verb === 'classroom_session'),
      ),
    ).toBe(true);
    await page.getByRole('button', { name: 'Step', exact: true }).click();
    await expect(page.getByTestId('lab-control-quarantine')).toContainText(
      'lab.invariant-halt',
    );
    for (const name of ['Play', 'Step', 'Start session', 'Direct to courtyard'])
      await expect(
        page.getByRole('button', { name, exact: true }),
      ).toBeDisabled();
    await expect(
      page.getByRole('combobox', { name: 'Speed', exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole('group', { name: 'Activity controls', exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Reset', exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole('combobox', { name: 'Scenario', exact: true }),
    ).toBeEnabled();
    const before = await frozen(page);
    checkpoints.halted = before;
    const aliases = await page.evaluate(() => {
      const e = (window as unknown as QuarantineWindow).__marsEngine;
      const classroom = e.classroom();
      const retainedClassroom = structuredClone(classroom);
      if (!classroom.session?.diagnostic?.subjects)
        throw new Error('missing classroom alias fixture');
      classroom.session.diagnostic.subjects.push('alias-mutation');
      classroom.session.diagnostic.message = 'alias-mutation';
      const violations = e.violations();
      if (!violations[0]?.subjects)
        throw new Error('missing invariant alias fixture');
      violations[0].subjects.push('alias-mutation');
      e.log()[0].text = 'alias-mutation';
      const diagnostics = e.sequence().diagnostics;
      if (!diagnostics.length)
        throw new Error('missing diagnostic alias fixture');
      diagnostics[0].text = 'alias-mutation';
      return { retainedClassroom, classroom: e.classroom() };
    });
    expect(aliases.classroom).toEqual(aliases.retainedClassroom);
    expect(await frozen(page)).toEqual(before);
    checkpoints.aliases = aliases;
    const refused = await page.evaluate(() => {
      const e = (window as unknown as QuarantineWindow).__marsEngine;
      const calls: [string, unknown[]][] = [
        ['startClassroom', []],
        ['cancelAction', [e.records()[0].id]],
        ['step', [1]],
        ['runToEnd', [10]],
        ['runUntilSteps', [[], 'completed', 10]],
        ['pause', [false]],
        ['setSpeed', [8]],
        ['probe', ['presenter1', { activity: 'walk' }, 1]],
        ['recordTake', []],
        ['replayTake', [[], 0]],
        ['endReplay', []],
        ['highlight', ['presenter1']],
        ['clearHighlights', []],
      ];
      return calls.map(([name, args]) => {
        try {
          Reflect.apply(
            (e as unknown as Record<string, (...args: unknown[]) => unknown>)[
              name
            ],
            e,
            args,
          );
          return { name, error: null };
        } catch (error) {
          return {
            name,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      });
    });
    expect(refused).toHaveLength(13);
    for (const call of refused) {
      expect(call.error, call.name).toContain(
        `lab.control-quarantined: ${call.name}`,
      );
      expect(call.error).toContain('fixture.control-quarantine');
      expect(call.error).toContain('Reset or choose a new scenario');
    }
    expect(await frozen(page)).toEqual(before);
    checkpoints.refused = refused;
    // Read-only actual facts and manual camera remain usable after containment.
    const reads = await page.evaluate(() => {
      const e = (window as unknown as QuarantineWindow).__marsEngine;
      e.cameraPreset('top');
      e.camera([14, 10, 14], [0, 0, 0]);
      return {
        state: e.state(),
        hash: e.stateHash(),
        classroom: e.classroom(),
        components: e.components(),
        fixtures: e.fixtures(),
        bones: e.bones(),
        held: e.heldItems(),
        slots: e.slots(),
        geometry: e.cameraGeometry(),
        camera: e.cameraPose(),
        hud: e.scenarioHud(),
        facts: e.cameraActivityReadout(),
        people: e.cameraEntities(),
      };
    });
    expect(reads.state.halted?.code).toBe('lab.invariant-halt');
    expect(reads.hud).toEqual([]);
    expect(reads.hash).toBe(before.hash);
    expect(await frozen(page)).toEqual(before);
    checkpoints.inspection = reads;
    await page.getByRole('button', { name: 'Oblique', exact: true }).click();
    expect(await frozen(page)).toEqual(before);
    mkdirSync(artifacts, { recursive: true });
    await page.screenshot({
      path: path.join(artifacts, 'control-quarantine-halted.png'),
    });
    writeFileSync(
      path.join(artifacts, 'control-quarantine-halted.a11y.yml'),
      await page.locator('body').ariaSnapshot(),
    );
    await page.evaluate(() => {
      (
        window as unknown as { restoreQuarantineFixture: () => void }
      ).restoreQuarantineFixture();
    });
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.waitForFunction(
      () =>
        (window as unknown as QuarantineWindow).__marsEngine.ready &&
        (window as unknown as QuarantineWindow).__marsEngine.state().tick === 0,
    );
    expect(
      await page.evaluate(
        () =>
          (window as unknown as QuarantineWindow).__marsEngine.state().halted,
      ),
    ).toBeNull();
    expect(
      await page.evaluate(() =>
        (window as unknown as QuarantineWindow).__marsEngine.violations(),
      ),
    ).toEqual([]);
    await expect(
      page.getByRole('button', { name: 'Start session', exact: true }),
    ).toBeEnabled();
    const started = await page.evaluate(() =>
      (window as unknown as QuarantineWindow).__marsEngine.startClassroom(),
    );
    expect(started.id).toBeTruthy();
    expect(started.status).not.toBe('failed');
    checkpoints.reset = await frozen(page);
  } finally {
    await page
      .evaluate(() => {
        (
          window as unknown as { restoreQuarantineFixture?: () => void }
        ).restoreQuarantineFixture?.();
      })
      .catch(() => {});
    mkdirSync(artifacts, { recursive: true });
    const file = path.join(artifacts, 'control-quarantine-proof.json');
    writeFileSync(
      file,
      JSON.stringify(
        {
          source,
          run: process.env.E2E_RUN,
          kind: 'deliberate invariant containment fixture, not a production journey',
          checkpoints,
        },
        null,
        2,
      ),
    );
    await testInfo.attach('quarantine-control-proof', {
      path: file,
      contentType: 'application/json',
    });
  }
});

test('alpha quarantine: future unclassified hook methods default to refusal and healthy API is unchanged', async ({
  page,
}) => {
  await page.goto('/lab?scenario=wall');
  await page.waitForFunction(
    () => (window as unknown as QuarantineWindow).__marsEngine?.ready,
  );
  const result = await page.evaluate(async () => {
    const modulePath = '/app/lab/hook.ts';
    const { fenceLabControls } = (await import(
      modulePath
    )) as typeof import('../app/lab/hook.ts');
    let reason: { code: string; message: string } | null = null;
    const h = fenceLabControls(
      {
        count: 0,
        futureControl(n: number) {
          this.count += n;
          return this.count;
        },
        state() {
          return this.count;
        },
      },
      () => reason,
    );
    const healthy = h.futureControl(3);
    reason = {
      code: 'fixture.unknown-fault',
      message: 'Deliberate unknown-fault fixture',
    };
    let refused = '';
    try {
      h.futureControl(2);
    } catch (error) {
      refused = error instanceof Error ? error.message : String(error);
    }
    const halted = h.state();
    reason = null;
    const recovered = h.futureControl(4);
    return { healthy, refused, halted, recovered };
  });
  expect(result.healthy).toBe(3);
  expect(result.halted).toBe(3);
  expect(result.recovered).toBe(7);
  expect(result.refused).toContain('lab.control-quarantined: futureControl');
  expect(result.refused).toContain('fixture.unknown-fault');
});

test('alpha quarantine: year-build inspection detaches pile coordinates and sequence HUD avoids halted admission reentry', async ({
  page,
}) => {
  await page.goto('/lab?scenario=year-build-2022');
  await page.waitForFunction(
    () => (window as unknown as QuarantineWindow).__marsEngine?.ready,
  );
  await page.evaluate(async () => {
    const modulePath = '/app/lab/scenarios.ts';
    const m = (await import(
      modulePath
    )) as typeof import('../app/lab/scenarios.ts');
    const s = m.scenarioByName('year-build-2022')!;
    const original = { ...s };
    let contained = false;
    s.admission = (rt) => {
      if (contained) throw new Error('fixture.sequence-admission-reentry');
      return original.admission?.(rt) ?? null;
    };
    s.build = () => {
      const rt = m.buildRuntime(original);
      rt.violations.push({
        tick: rt.tick,
        code: 'fixture.year-build-quarantine',
        message: 'Test-only pre-existing violation',
        subjects: ['pile'],
        at: [0, 0, 0],
      });
      contained = true;
      return rt;
    };
  });
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.getByTestId('lab-control-quarantine')).toContainText(
    'fixture.year-build-quarantine',
  );
  await expect(page.getByTestId('sequence-hud')).toBeVisible();
  const result = await page.evaluate(() => {
    const e = (window as unknown as QuarantineWindow).__marsEngine;
    const before = {
      hash: e.stateHash(),
      year: e.yearBuild(),
      diagnostics: e.sequence().diagnostics,
    };
    const edited = e.yearBuild();
    if (!edited?.piles.length)
      throw new Error('missing year-build pile alias fixture');
    edited.piles[0].p[0] += 100;
    edited.centre[0] += 100;
    e.sequence().diagnostics[0].text = 'alias-mutation';
    return {
      before,
      after: {
        hash: e.stateHash(),
        year: e.yearBuild(),
        diagnostics: e.sequence().diagnostics,
      },
    };
  });
  expect(result.after).toEqual(result.before);
});
