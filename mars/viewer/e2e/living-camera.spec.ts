import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
import type { attachLabCamera } from '../cinematography/lab-driver.ts';

declare global {
  interface Window {
    __marsEngine: EngineHook;
    __livingCameraProof: ReturnType<typeof attachLabCamera>;
  }
}
const artifacts = path.resolve(
  'e2e/artifacts',
  process.env.E2E_RUN ?? 'living-camera',
);

for (const [scenario, policy, worker, workstation] of [
  ['living-day-4', 'clear', 'original', 'preferred'],
  ['living-day-studio', 'restrained', 'assistant', 'alternative'],
] as const) {
  test(`${scenario}: actual Play ${policy} coverage and explicit worker follow preserve authority`, async ({
    page,
  }) => {
    test.setTimeout(360_000);
    mkdirSync(artifacts, { recursive: true });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const button = (name: string) =>
      page.getByRole('button', { name, exact: true });
    await page.goto(`/lab?scenario=${scenario}`);
    await page.waitForFunction(() => window.__marsEngine?.ready);
    await page.evaluate(
      (name) =>
        window.__marsEngine.runScenario(name, { paused: true, speed: 4 }),
      scenario,
    );
    await page
      .getByRole('combobox', { name: 'Day participant', exact: true })
      .selectOption(worker);
    await page
      .getByRole('combobox', { name: 'Day workstation', exact: true })
      .selectOption(workstation);
    await button('Start connected day').click();
    const beforeAttach = await page.evaluate(() =>
      window.__marsEngine.stateHash(),
    );
    // The UI remains Manual: this is the only live controller, using the production adapter.
    await page.evaluate(async (mode) => {
      const module = '/cinematography/lab-driver.ts';
      const { attachLabCamera } = await import(module);
      window.__livingCameraProof = attachLabCamera(window.__marsEngine, mode);
    }, policy);
    await page.waitForFunction(
      () => window.__livingCameraProof.report().frames.length > 0,
    );
    expect(await page.evaluate(() => window.__marsEngine.stateHash())).toBe(
      beforeAttach,
    );
    const stages: unknown[] = [];
    const capture = async (label: string) => {
      await button('Pause').click();
      await page.waitForTimeout(300); // Allow the last actual tick to reach the camera RAF.
      stages.push(
        await page.evaluate(
          (label) => ({
            label,
            state: window.__marsEngine.state(),
            day: window.__marsEngine.livingDay(),
            routine: window.__marsEngine.purposefulRoutine(),
            facts: window.__marsEngine.cameraActivityReadout(),
            camera: window.__livingCameraProof.report().observations.at(-1)
              ?.activity,
            pose: window.__marsEngine.cameraPose(),
          }),
          label,
        ),
      );
      await page.screenshot({
        path: path.join(artifacts, `${scenario}-${policy}-${label}.png`),
      });
      await button('Play').click();
    };
    try {
      await button('Play').click();
      await page.waitForFunction(() => {
        const day = window.__marsEngine.livingDay();
        return day?.phase === 'initial-work';
      });
      await capture('notes');
      await page.waitForFunction(() => {
        const reading = window.__marsEngine.reading();
        return (
          !('code' in reading) && reading.elapsed > 1 && reading.elapsed < 6
        );
      });
      await button('pause reader').click();
      const pausedAt = await page.evaluate(
        () => window.__marsEngine.state().time,
      );
      await page.waitForFunction(
        (time) => window.__marsEngine.state().time >= time + 5,
        pausedAt,
      );
      await capture('reader-paused-active-others');
      expect(
        await page.evaluate(
          () =>
            window.__livingCameraProof.report().observations.at(-1)?.activity
              .focus,
        ),
      ).not.toBe('reader');
      await button('resume reader').click();
      await page.waitForFunction(
        () => window.__marsEngine.classroom().session?.phase === 'presenting',
      );
      await capture('talk');
      await page.waitForFunction(() => {
        const p = window.__marsEngine.purposefulRoutine()?.preparation;
        return (
          !!p && p.ingredients.some((i) => i.deposited > 0 && i.deposited < 1)
        );
      });
      await capture('preparation');
      await button('Pause').click();
      const followActor = worker === 'assistant' ? 'day-editor' : 'worker';
      const authority = await page.evaluate(() => ({
        hash: window.__marsEngine.stateHash(),
        tick: window.__marsEngine.state().tick,
      }));
      await page.evaluate(
        (actor) => window.__livingCameraProof.takeover(actor, 6),
        followActor,
      );
      await expect(page.getByText(/^OPERATOR ·/)).toBeVisible();
      expect(
        await page.evaluate(() => ({
          hash: window.__marsEngine.stateHash(),
          tick: window.__marsEngine.state().tick,
        })),
      ).toEqual(authority);
      await page.screenshot({
        path: path.join(artifacts, `${scenario}-${policy}-follow-worker.png`),
      });
      const followStart = await page.evaluate(
        () => window.__marsEngine.state().time,
      );
      await button('Play').click();
      await page.waitForFunction(
        (time) => window.__marsEngine.state().time > time + 7,
        followStart,
      );
      // Operator takeover may retain exactly the already-selected worker shot.
      // Decisions record changes/cuts, so a new operator Decision is not required.
      await expect(page.getByText(/^AUTO ·/)).toBeVisible();
      await button('Pause').click();
      await page.evaluate(() => window.__livingCameraProof.release());
      expect(
        await page.evaluate(() => window.__marsEngine.state().tick),
      ).toBeGreaterThan(authority.tick);
      await button('Play').click();
      await page.waitForFunction(() =>
        window.__marsEngine.purposefulRoutine()?.phase.startsWith('food-'),
      );
      await capture('meal');
      await page.waitForFunction(
        () =>
          window.__marsEngine.purposefulRoutine()?.sleep?.mode === 'sleeping',
      );
      // Observe overlapping rest and music at real-time speed, without posing the camera.
      await page.evaluate(() => window.__marsEngine.setSpeed(1));
      await capture('sleep');
      await page.waitForFunction(
        () =>
          window.__marsEngine.livingDay()?.musicState?.phase ===
          'music-and-dance',
      );
      await capture('music');
      await page.waitForTimeout(13_000);
      await capture('sleep-music-sustained');
      await page.evaluate(() => window.__marsEngine.setSpeed(4));
      await page.waitForFunction(
        () => window.__marsEngine.livingDay()?.phase === 'completed',
      );
      await capture('completed');
      await button('Pause').click();
      const report = await page.evaluate(() =>
        window.__livingCameraProof.report(),
      );
      expect(report.policy).toBe(policy);
      expect(report.frames.length).toBeGreaterThan(50);
      expect(
        report.frames.every((f) =>
          [...f.pose.position, ...f.pose.target, f.pose.fov].every(
            Number.isFinite,
          ),
        ),
      ).toBe(true);
      expect(
        new Set(report.frames.map((f) => JSON.stringify(f.pose.position))).size,
      ).toBeGreaterThan(2);
      expect(report.observations.some((o) => o.subjects[followActor])).toBe(
        true,
      );
      expect(
        await page.evaluate(() => window.__marsEngine.violations()),
      ).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await page.evaluate(() => window.__marsEngine.pause(true));
      const report = await page.evaluate(() =>
        window.__livingCameraProof.report(),
      );
      const finalState = await page.evaluate(() => ({
        day: window.__marsEngine.livingDay(),
        routine: window.__marsEngine.purposefulRoutine(),
        violations: window.__marsEngine.violations(),
      }));
      writeFileSync(
        path.join(artifacts, `${scenario}-${policy}-proof.json`),
        JSON.stringify(
          {
            scenario,
            policy,
            worker,
            workstation,
            stages,
            report,
            finalState,
            errors,
          },
          null,
          2,
        ),
      );
      const beforeDispose = await page.evaluate(() =>
        window.__marsEngine.stateHash(),
      );
      await page.evaluate(() => window.__livingCameraProof.dispose());
      expect(await page.evaluate(() => window.__marsEngine.stateHash())).toBe(
        beforeDispose,
      );
    }
  });
}
