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

// UI time is the only physical execution driver. Diagnostic admission and
// cancellation use the existing ordinary hooks, never pose writes or fast-forward.
const scripted = [
  'wall',
  'u-trap',
  'narrow-passage',
  'stairs',
  'deck-to-ground',
  'construction',
  'trio',
  'build-bay',
  'hand-up',
  'prone',
  'prone-forks',
  'campfire-evening',
  'meal',
  ...[2020, 2021, 2022, 2023, 2024, 2025, 2026].map((y) => `year-${y}`),
  'solar-paint',
];
const terminal = ['completed', 'cancelled', 'failed'];
const artifacts = path.resolve(
  'e2e/artifacts',
  process.env.E2E_RUN ?? 'alpha-preset-play',
);
const source = {
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  base: '470e9c54d21d8351d91a95555e9d1eb0f8d061fa',
  specSha256: createHash('sha256')
    .update(readFileSync(import.meta.filename))
    .digest('hex'),
};
const button = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true });
async function play(page: Page) {
  if ((await page.evaluate(() => window.__marsEngine.state())).paused)
    await button(page, 'Play').click();
}
async function freeze(page: Page) {
  if (!(await page.evaluate(() => window.__marsEngine.state())).paused)
    await button(page, 'Pause').click();
}
async function snapshot(page: Page) {
  return page.evaluate(() => {
    const e = window.__marsEngine;
    return {
      state: e.state(),
      hash: e.stateHash(),
      error: e.error,
      records: e.records(),
      components: e.components(),
      fixtures: e.fixtures(),
      held: e.heldItems(),
      slots: e.slots(),
      claims: e.garden().claims,
      bones: e.bones(),
      paints: e.paints(),
      sequence: e.sequence(),
      social: e.social(),
      violations: e.violations(),
      resources: e.info(),
      hud: e.scenarioHud(),
      backdropReady: e.backdropReady,
    };
  });
}
type Evidence = Awaited<ReturnType<typeof snapshot>>;
function sound(d: Evidence) {
  expect(d.error).toBe('');
  expect(d.state.halted).toBeNull();
  expect(d.violations).toEqual([]);
  expect(d.state.humans.length).toBeGreaterThan(0);
  for (const h of d.state.humans)
    expect([...h.p, h.yaw, h.level].every(Number.isFinite), h.id).toBe(true);
  for (const c of [...d.components, ...d.fixtures]) {
    expect(
      [...c.pose.p, c.pose.yaw, c.pose.pitch ?? 0, c.pose.roll ?? 0].every(
        Number.isFinite,
      ),
      c.id,
    ).toBe(true);
    if (d.components.some((q) => q.id === c.id))
      expect(c.support, `${c.id} has authoritative support`).toBeTruthy();
  }
  for (const r of d.records.filter((r) => r.status === 'failed')) {
    expect(
      r.diagnostic?.code,
      `${r.id} failure has named diagnostic`,
    ).toBeTruthy();
    expect(r.diagnostic?.message).toBeTruthy();
  }
}
async function capture(page: Page, name: string, label: string) {
  await freeze(page);
  await page.evaluate(() => window.__marsEngine.cameraPreset('oblique'));
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const data = await snapshot(page);
  mkdirSync(artifacts, { recursive: true });
  const file = path.join(artifacts, `${name}-${label}`);
  await page.screenshot({ path: file + '.png' });
  writeFileSync(
    file + '.json',
    JSON.stringify({ source, run: process.env.E2E_RUN, label, data }, null, 2),
  );
  writeFileSync(file + '.a11y.yml', await page.locator('body').ariaSnapshot());
  sound(data);
  return data;
}
async function open(page: Page, name: string, speed = 4) {
  await page.goto(`/lab?scenario=${name}`);
  // Actual selected preset awaits its real async prepare, rather than a fixture
  // or a synchronous runScenario. Large year data must fit the same whole-case cap.
  await page.waitForFunction(
    (n) =>
      (window.__marsEngine?.ready &&
        window.__marsEngine.state().scenario === n) ||
      !!window.__marsEngine?.error,
    name,
    { timeout: 60000 },
  );
  expect(
    await page
      .getByRole('combobox', { name: 'Scenario', exact: true })
      .inputValue(),
  ).toBe(name);
  await expect(button(page, 'Play')).toBeEnabled();
  await page
    .getByRole('combobox', { name: 'Speed', exact: true })
    .selectOption(String(speed));
  if (name.startsWith('year-'))
    await page.waitForFunction(() => window.__marsEngine.backdropReady, null, {
      timeout: 60000,
    });
}
async function reach(
  page: Page,
  stage: 'progress' | 'endpoint' | 'drained' | number,
) {
  await play(page);
  await page.waitForFunction(
    (stage) => {
      const e = window.__marsEngine,
        s = e.state();
      if (e.error || s.halted || e.violations().length)
        throw new Error(
          JSON.stringify({
            error: e.error,
            halted: s.halted,
            violations: e.violations(),
          }),
        );
      if (typeof stage === 'number') return s.tick >= stage;
      if (stage === 'endpoint') return s.done;
      if (stage === 'drained')
        return e
          .records()
          .every((r) =>
            ['completed', 'cancelled', 'failed'].includes(r.status),
          );
      return s.tick >= 40 || s.done;
    },
    stage,
    { timeout: 120000 },
  );
}
function effects(name: string, initial: Evidence, end: Evidence) {
  for (const c of end.state.checks) expect(c.ok, c.message).toBe(true);
  expect(end.state.done).toBe(true);
  expect(end.records.length).toBeGreaterThan(0);
  const moved = end.state.humans.filter((h) => {
    const old = initial.state.humans.find((q) => q.id === h.id)!;
    return Math.hypot(...h.p.map((v, i) => v - old.p[i])) > 0.05;
  });
  expect(
    moved.length,
    'named physical journey moves at least one authored actor',
  ).toBeGreaterThan(0);
  if (name === 'trio') expect(moved).toHaveLength(3);
  if (name === 'construction') {
    expect(end.components.find((c) => c.id === 'panel')?.phase).toBe(
      'installed',
    );
    expect(end.records[0].outputs?.replans).toBe(1);
  }
  if (name.startsWith('year-')) {
    expect(end.state.humans).toHaveLength(4);
    expect(moved).toHaveLength(4);
    expect(end.backdropReady).toBe(true);
    expect(end.records).toHaveLength(4);
  }
  if (!['meal', 'campfire-evening'].includes(name))
    expect(
      end.records.every((r) => r.status === 'completed'),
      'all ordinary physical children completed',
    ).toBe(true);
  if (!['meal', 'campfire-evening'].includes(name)) {
    expect(end.held).toEqual([]);
    expect(Object.values(end.claims).filter(Boolean)).toEqual([]);
  }
  if (['build-bay', 'hand-up'].includes(name)) {
    expect(end.sequence.steps?.every((s) => s.status === 'completed')).toBe(
      true,
    );
    for (const id of ['s1', 's2'])
      expect(end.components.find((c) => c.id === id)?.phase, id).toBe(
        'installed',
      );
    if (name === 'build-bay') {
      for (const id of ['A', 'B'])
        expect(end.components.find((c) => c.id === id)?.phase, id).toBe(
          'installed',
        );
      expect(end.state.humans.find((h) => h.id === 'visitor')?.level).toBe(4);
    }
  }
  if (name.startsWith('prone')) {
    const sheet = end.components.find((c) => c.id === 's1');
    expect(sheet?.phase).toBe('staged');
    expect(sheet?.support).toBe('resting-on');
  }
  if (name === 'stairs' || name === 'deck-to-ground') {
    expect(end.state.humans.find((h) => h.id === 'p1')?.level).toBe(
      name === 'stairs' ? 1 : 0,
    );
    expect(
      end.records.some((r) =>
        r.history.some((h: { phase?: string }) => h.phase === 'climb'),
      ),
    ).toBe(true);
  }
  if (name === 'solar-paint') {
    const panel = end.components.find((c) => c.id === 'pv1')!;
    expect(Math.hypot(panel.pose.p[0] - 5, panel.pose.p[2] - 3)).toBeLessThan(
      0.05,
    );
    // Original expect() also enforces BOTH authored mural coverage >=.6.
    expect(
      end.state.checks.some((c) => c.message.startsWith('painted w1')),
    ).toBe(true);
  }
  if (name === 'meal') {
    expect(
      end.records.filter((r) => r.verb === 'eat' && r.status === 'completed'),
    ).toHaveLength(4);
    expect(end.held.filter((q) => /^bowl[1-4]$/.test(q.id))).toHaveLength(4);
    for (const b of end.held.filter((q) => /^bowl[1-4]$/.test(q.id)))
      expect(b.fraction, b.id).toBeLessThanOrEqual(1e-9);
  }
  if (name === 'campfire-evening') {
    const failed = end.records.filter((r) => r.status === 'failed');
    expect(failed).toHaveLength(2);
    expect(
      failed
        .map((r) => r.diagnostic?.code)
        .sort((a, b) => (a ?? '').localeCompare(b ?? '')),
    ).toEqual(['reservation.conflict', 'slot.none-free']);
    expect(
      end.social?.fired.find((f) => f.id === 'pull-release')?.cancelled,
    ).toHaveLength(1);
    expect(
      end.slots.filter((q) => q.id.startsWith('fire#') && q.claimedBy),
    ).toHaveLength(7);
    expect(
      end.records.some(
        (r) =>
          r.verb === 'converse' &&
          r.phase === 'talking' &&
          r.status === 'executing',
      ),
    ).toBe(true);
  }
}
async function reset(page: Page, name: string, initial: Evidence) {
  await button(page, 'Reset').click();
  await page.waitForFunction(
    (n) =>
      window.__marsEngine.ready &&
      window.__marsEngine.state().scenario === n &&
      window.__marsEngine.state().tick === 0,
    name,
    { timeout: 15000 },
  );
  const fresh = await capture(page, name, 'reset');
  expect(fresh.state.humans).toEqual(initial.state.humans);
  expect(fresh.components).toEqual(initial.components);
  expect(fresh.fixtures).toEqual(initial.fixtures);
  expect(fresh.held).toEqual(initial.held);
  expect(fresh.claims).toEqual(initial.claims);
  expect(fresh.resources.geometries).toBe(initial.resources.geometries);
  expect(fresh.resources.textures).toBe(initial.resources.textures);
}
for (const name of [...scripted, 'incomplete-stairs', 'stress-30']) {
  test(`alpha ${name}: fullPlay ${name === 'stress-30' ? 'sustained retargeting beyond60s' : name === 'incomplete-stairs' ? 'named refusal and usable world' : 'authored meaningful endpoint and retained supports'}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    const checkpoints: Record<string, Evidence> = {};
    let failure: unknown;
    try {
      await open(page, name, ['hand-up', 'build-bay'].includes(name) ? 8 : 4);
      checkpoints.initial = await capture(page, name, 'initial');
      if (name === 'stress-30') {
        expect(checkpoints.initial.state.humans).toHaveLength(30);
        for (const tick of [600, 1250, 2000]) {
          await reach(page, tick);
          const d = await capture(page, name, `live-${tick}`);
          checkpoints[`live-${tick}`] = d;
          const live = d.records.filter((r) => !terminal.includes(r.status));
          expect(
            live.length,
            'at most one walk per actual wanderer',
          ).toBeLessThanOrEqual(30);
          expect(live.every((r) => r.verb === 'walk_to')).toBe(true);
          expect(
            Object.values(d.claims).filter(Boolean).length,
          ).toBeLessThanOrEqual(30);
          for (const c of d.state.checks) expect(c.ok, c.message).toBe(true);
          expect(d.records.some((r) => r.status === 'completed')).toBe(true);
        }
        const before = checkpoints['live-600'],
          after = checkpoints['live-2000'];
        expect(
          after.records.filter((r) => r.status === 'completed').length,
        ).toBeGreaterThan(
          before.records.filter((r) => r.status === 'completed').length,
        );
        const late = after.records.filter((r) => r.requestedTick > 1250);
        expect(
          late.length,
          'new walk requests AFTER original60s script budget',
        ).toBeGreaterThan(0);
        expect(
          late.some((r) => r.status === 'completed'),
          'fresh post-budget walks complete',
        ).toBe(true);
        expect(
          after.state.humans.some((h) =>
            h.p.some(
              (v, i) =>
                v !==
                checkpoints['live-1250'].state.humans.find(
                  (q) => q.id === h.id,
                )!.p[i],
            ),
          ),
        ).toBe(true);
      } else {
        await reach(page, 'progress');
        checkpoints.progress = await capture(page, name, 'progress');
        await reach(page, 'endpoint');
        const end = await capture(page, name, 'endpoint');
        checkpoints.endpoint = end;
        if (name === 'incomplete-stairs') {
          for (const c of end.state.checks) expect(c.ok, c.message).toBe(true);
          expect(end.records).toHaveLength(1);
          expect(end.records[0].status).toBe('failed');
          expect(end.records[0].diagnostic?.code).toBe('route.link-unusable');
          expect(end.records[0].diagnostic?.message).toMatch(/stairs-(a|b)/);
          expect(end.state.humans).toEqual(checkpoints.initial.state.humans);
          await expect(
            page.getByRole('alert').filter({ hasText: 'route.link-unusable' }),
          ).toBeVisible();
          await reach(page, end.state.tick + 40);
          checkpoints.usable = await capture(page, name, 'usable-clock');
          expect(checkpoints.usable.state.tick).toBeGreaterThan(end.state.tick);
          await expect(button(page, 'Step')).toBeEnabled();
        } else effects(name, checkpoints.initial, end);
        if (name === 'campfire-evening') {
          await page.evaluate(() => {
            const e = window.__marsEngine;
            for (const r of e
              .records()
              .filter(
                (r) =>
                  !r.parent &&
                  !['completed', 'cancelled', 'failed'].includes(r.status),
              ))
              e.cancelAction(r.id);
          });
          await reach(page, 'drained');
          const drained = await capture(page, name, 'safe-cancel-drained');
          checkpoints.drained = drained;
          expect(
            drained.records.every((r) => terminal.includes(r.status)),
          ).toBe(true);
          expect(drained.held).toEqual([]);
          expect(drained.slots.filter((q) => q.claimedBy)).toEqual([]);
          expect(Object.values(drained.claims).filter(Boolean)).toEqual([]);
          await reach(page, drained.state.tick + 40);
          checkpoints.usable = await capture(page, name, 'usable-after-end');
        }
      }
      await reset(page, name, checkpoints.initial);
      expect(errors).toEqual([]);
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      try {
        checkpoints.final = await capture(
          page,
          name,
          failure ? 'failure' : 'final',
        );
      } catch (error) {
        errors.push(`final capture: ${String(error)}`);
      }
      mkdirSync(artifacts, { recursive: true });
      const file = path.join(artifacts, `${name}-proof.json`);
      writeFileSync(
        file,
        JSON.stringify(
          {
            source,
            run: process.env.E2E_RUN,
            test: testInfo.title,
            expectedStatus: testInfo.expectedStatus,
            statusAtFinally: testInfo.status,
            failure: failure
              ? failure instanceof Error
                ? (failure.stack ?? failure.message)
                : JSON.stringify(failure)
              : null,
            errors,
            checkpoints,
          },
          null,
          2,
        ),
      );
      await testInfo.attach('actual-Play-proof', {
        path: file,
        contentType: 'application/json',
      });
    }
  });
}
