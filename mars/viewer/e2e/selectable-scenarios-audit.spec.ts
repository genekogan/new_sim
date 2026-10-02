/// <reference types="node" />
// Selector smoke only: fresh load, Reset, first fixed Step. Never journey completion.
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SELECTABLE_SCENARIOS } from '../app/lab/scenarios.ts';
import type { EngineHook } from '../app/lab/hook.ts';
declare global {
  interface Window {
    __marsEngine: EngineHook;
  }
}
type Mode =
  | 'manual-start'
  | 'manual-probe'
  | 'continuous-autonomous'
  | 'scripted'
  | 'diagnostic-demo'
  | 'conditional-admission';
type Outcome =
  | 'not-run'
  | 'boot-smoke-passed'
  | 'expected-diagnostic-observed'
  | 'unsupported-admission'
  | 'unexpected-failure';
const inventory = SELECTABLE_SCENARIOS.map((s) => ({
  name: s.name,
  title: s.title,
  continuous: !!s.continuous,
  asyncPreparation: !!s.prepare,
  hasAdmission: !!s.admission,
  authoredExpectedFailure: !!s.expectedFailure,
  mode: (s.name === 'incomplete-stairs'
    ? 'diagnostic-demo'
    : s.name === 'body'
      ? 'manual-probe'
      : s.name.startsWith('stress-')
        ? 'continuous-autonomous'
        : s.admission
          ? 'conditional-admission'
          : s.continuous
            ? 'manual-start'
            : 'scripted') as Mode,
}));
const artifacts = path.resolve(
  'e2e/artifacts',
  process.env.E2E_RUN ?? 'selectable-scenarios-audit',
  'selectable-audit',
);
interface Row {
  name: string;
  mode: Mode;
  outcome: Outcome;
  stages?: unknown;
  pageErrors: string[];
  failure?: string;
  completionProven: false;
}
const results = new Map<string, Row>();
function writeRow(row: Row) {
  mkdirSync(artifacts, { recursive: true });
  results.set(row.name, row);
  writeFileSync(
    path.join(artifacts, `${row.name}.json`),
    JSON.stringify(row, null, 2) + '\n',
  );
}
function readRow(name: string): Row | undefined {
  // A failing case restarts the worker. Preserve earlier receipts on disk.
  const filename = path.join(artifacts, `${name}.json`);
  if (!existsSync(filename)) return undefined;
  return JSON.parse(readFileSync(filename, 'utf8')) as Row;
}
async function bootstrap(page: Page) {
  // Known proving-ground bootstrap, then target receives its own fresh Runtime.
  await page.goto('/lab?scenario=wall');
  await page.waitForFunction(() => window.__marsEngine?.ready);
  await page.evaluate(() =>
    window.__marsEngine.runScenario('wall', { paused: true }),
  );
}
async function snapshot(page: Page) {
  return page.evaluate(() => {
    const h = window.__marsEngine;
    return {
      state: h.state(),
      records: h.records() as {
        id: string;
        verb: string;
        status: string;
        diagnostic?: { code: string; message: string; subjects?: string[] };
      }[],
      violations: h.violations(),
      admission: h.yearBuild()?.admission ?? null,
      diagnostics: h.sequence().diagnostics,
      cameraError: h.error ?? null,
    };
  });
}
type Snapshot = Awaited<ReturnType<typeof snapshot>>;
function assertSafety(s: Snapshot, name: string) {
  expect(s.state.scenario, 'actual selected scenario').toBe(name);
  expect(s.state.paused, 'smoke never silently runs the journey').toBe(true);
  // Intentional action refusals never excuse authoritative invariant violations.
  expect(s.violations, `${name}: authoritative violations`).toEqual([]);
  expect(s.cameraError, `${name}: renderer/bootstrap error`).toBeNull();
}
function assertDiagnostics(s: Snapshot, mode: Mode, name: string) {
  if (s.admission) {
    expect(mode, 'only authored admission scenarios may refuse startup').toBe(
      'conditional-admission',
    );
    expect(s.admission.code).toBe('year-build.unsupported');
    expect(s.admission.message.length).toBeGreaterThan(0);
    expect(
      s.admission.subjects?.length ?? 0,
      'named omitted parts',
    ).toBeGreaterThan(0);
    expect(
      s.records,
      'unsupported admission acquires no physical action',
    ).toEqual([]);
    return;
  }
  const failed = s.records.filter(
    (r) => r.status === 'failed' || r.status === 'cancelled',
  );
  if (mode === 'diagnostic-demo') {
    expect(failed).toHaveLength(1);
    expect(failed[0].status).toBe('failed');
    expect(failed[0].diagnostic?.code).toBe('route.link-unusable');
    expect(failed[0].diagnostic?.message).toMatch(/stairs-(a|b)/);
    return;
  }
  // campfire's authored full-circle refusals occur at 50s, outside this smoke's one tick.
  // Any initial failed record here is unexpected, even in that scenario.
  expect(failed, `${name}: unexpected initial action failure`).toEqual([]);
  expect(
    s.diagnostics.filter((d) => d.level === 'error'),
    `${name}: unexpected diagnostic error`,
  ).toEqual([]);
}
async function captureFailure(page: Page, info: TestInfo, name: string) {
  mkdirSync(artifacts, { recursive: true });
  if (!page.isClosed())
    try {
      await page.screenshot({
        path: path.join(artifacts, `${name}-failure.png`),
        timeout: 5000,
      });
    } catch {
      /* retain original failure */
    }
  await info.attach(`${name}-audit`, {
    path: path.join(artifacts, `${name}.json`),
    contentType: 'application/json',
  });
}
test.afterAll(() => {
  mkdirSync(artifacts, { recursive: true });
  const rows = inventory.map(
    (s) =>
      results.get(s.name) ??
      readRow(s.name) ?? {
        name: s.name,
        mode: s.mode,
        outcome: 'not-run' as Outcome,
        pageErrors: [],
        completionProven: false,
      },
  );
  const outcomes: Outcome[] = [
    'not-run',
    'boot-smoke-passed',
    'expected-diagnostic-observed',
    'unsupported-admission',
    'unexpected-failure',
  ];
  const counts = Object.fromEntries(
    outcomes.map((outcome) => [
      outcome,
      rows.filter((r) => r.outcome === outcome).length,
    ]),
  );
  writeFileSync(
    path.join(artifacts, 'summary.json'),
    JSON.stringify(
      {
        scope: 'fresh-load/reset/first-step only; no completion proof',
        inventory,
        counts,
        rows,
        unsupportedIsNotActivityPass: true,
      },
      null,
      2,
    ) + '\n',
  );
});
test('selector inventory matches every authored selectable scenario', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await bootstrap(page);
  expect(new Set(inventory.map((s) => s.name)).size).toBe(inventory.length);
  const browser = await page.evaluate(() => window.__marsEngine.scenarios());
  expect(
    browser.map((s) => ({ name: s.name, continuous: s.continuous })),
  ).toEqual(inventory.map((s) => ({ name: s.name, continuous: s.continuous })));
  await expect(
    page
      .getByRole('combobox', { name: 'Scenario', exact: true })
      .locator('option'),
  ).toHaveCount(inventory.length);
  expect(errors).toEqual([]);
});
// Independent default-mode cases: one failure never skips the remaining inventory.
for (const scenario of inventory)
  test(`${scenario.name}: ${scenario.mode} fresh load / Reset / first Step`, async ({
    page,
  }, info) => {
    const row: Row = {
      name: scenario.name,
      mode: scenario.mode,
      outcome: 'not-run',
      pageErrors: [],
      completionProven: false,
    };
    const stages: Partial<Record<'loaded' | 'reset' | 'stepped', Snapshot>> =
      {};
    row.stages = stages;
    page.on('pageerror', (e) => row.pageErrors.push(e.message));
    try {
      await bootstrap(page);
      const selected = await page.evaluate(
        (name) => window.__marsEngine.runScenario(name, { paused: true }),
        scenario.name,
      );
      expect(selected.scenario).toBe(scenario.name);
      await page.waitForFunction(() => window.__marsEngine.ready);
      const loaded = await snapshot(page);
      stages.loaded = loaded;
      assertSafety(loaded, scenario.name);
      assertDiagnostics(loaded, scenario.mode, scenario.name);
      expect(loaded.state.tick).toBe(0);
      const epoch = await page.evaluate(
        () => window.__marsEngine.scenarioEpoch,
      );
      await page.getByRole('button', { name: 'Reset', exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => window.__marsEngine.scenarioEpoch))
        .toBeGreaterThan(epoch);
      const reset = await snapshot(page);
      stages.reset = reset;
      assertSafety(reset, scenario.name);
      assertDiagnostics(reset, scenario.mode, scenario.name);
      expect(reset.state.tick).toBe(0);
      await page.getByRole('button', { name: 'Step', exact: true }).click();
      const stepped = await snapshot(page);
      stages.stepped = stepped;
      assertSafety(stepped, scenario.name);
      assertDiagnostics(stepped, scenario.mode, scenario.name);
      expect(stepped.state.tick).toBe(1);
      if (scenario.mode === 'manual-start' || scenario.mode === 'manual-probe')
        expect(
          stepped.records,
          'no activity implicitly starts on first Step',
        ).toEqual([]);
      if (scenario.mode === 'diagnostic-demo')
        expect(stepped.state.humans.map((h) => h.p)).toEqual(
          reset.state.humans.map((h) => h.p),
        );
      if (scenario.hasAdmission)
        expect(stepped.admission).toEqual(reset.admission);
      expect(row.pageErrors, `${scenario.name}: page errors`).toEqual([]);
      row.outcome = stepped.admission
        ? 'unsupported-admission'
        : scenario.mode === 'diagnostic-demo'
          ? 'expected-diagnostic-observed'
          : 'boot-smoke-passed';
      writeRow(row);
      await info.attach('classification', {
        body: JSON.stringify(row, null, 2),
        contentType: 'application/json',
      });
      if (scenario.name === 'wall')
        await page.screenshot({
          path: path.join(artifacts, 'wall-representative-first-step.png'),
        });
    } catch (error) {
      row.outcome = 'unexpected-failure';
      row.failure = String(error);
      writeRow(row);
      await captureFailure(page, info, scenario.name);
      throw error;
    }
  });
