// Engine Lab: the "campfire-evening" inhabited scene (app/lab/campfire-evening.ts, milestone H).
// Runs the social script to completion via window.__marsEngine, asserts every expectation (fire
// circle facing inward, seated people on their seats, the conversing pair facing each other,
// pre-emption keeps the circle, the full-circle conflict is an EXPECTED diagnostic, zero
// violations, nobody overlapping), replays deterministically, and captures oblique + top views
// with overlays off/on at 20 s and 65 s.
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { captureView, collectConsoleErrors } from './helpers';
import { labFrames, openLab, type LabState } from './lab-helpers';

const BASELINES = new Set(['lab-social-t20-oblique', 'lab-social-t65-top-debug']);
const FIRE = [-22, -22.5];
const DEBUG = ['agents', 'labels', 'slots', 'routes'];

type SlotRow = { id: string; kind: string; p: number[]; yaw: number; claimedBy: string | null; claimant: string | null; occupant: string | null; state: string };
type Social = { fired: { id: string; recs: { id: string; verb: string; status: string; phase: string | null; code: string | null; message: string | null }[]; cancelled: string[] | null }[]; notes: { level: string; text: string }[] };
type Extra = { slots(): SlotRow[]; social(): Social | null };
const ext = (page: Page) => ({
  slots: () => page.evaluate(() => (window.__marsEngine as unknown as Extra).slots()),
  social: () => page.evaluate(() => (window.__marsEngine as unknown as Extra).social()),
});
const step = (page: Page, n: number): Promise<LabState> => page.evaluate((k) => window.__marsEngine!.step(k), n);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const facing = (from: number[], yaw: number, to: number[]) => Math.abs(wrap(Math.atan2(to[1] - from[1], to[0] - from[0]) - yaw));

async function overlays(page: Page, on: boolean) {
  await page.evaluate(([names, v]) => (names as string[]).forEach((n) => window.__marsEngine!.setOverlay(n, v as boolean)), [DEBUG, on] as const);
  await labFrames(page);
}

async function shots(page: Page, base: string, testInfo: TestInfo) {
  for (const cam of ['oblique', 'top'] as const) {
    await page.evaluate((c) => window.__marsEngine!.cameraPreset(c), cam);
    for (const debug of [false, true]) {
      await overlays(page, debug);
      const name = `${base}-${cam}${debug ? '-debug' : ''}`;
      await captureView(page, name, { testInfo, compare: BASELINES.has(name) });
    }
  }
  await overlays(page, false);
}

/** The scene as a person would judge it: circle facing inward, sitters on seats, the pair face to face, no overlaps. */
async function arrangement(page: Page, st: LabState) {
  const slots = await ext(page).slots();
  const at = (id: string) => st.humans.find((h) => h.id === id)!;
  const warm = st.humans.filter((h) => h.activity === 'warm');
  for (const h of warm) {
    const p = [h.p[0], h.p[2]];
    expect(Math.hypot(p[0] - FIRE[0], p[1] - FIRE[1]), `${h.id} on the 1.6 m fire ring`).toBeCloseTo(1.6, 1);
    expect(facing(p, h.yaw, FIRE), `${h.id} faces the fire`).toBeLessThan(0.2);
    expect(slots.find((q) => q.occupant === h.id && q.kind === 'fire-circle')?.state, `${h.id} occupies its claimed fire place`).toBe('occupied');
  }
  for (const h of st.humans.filter((x) => x.activity === 'sit')) {
    const seat = slots.find((q) => q.occupant === h.id && q.kind === 'seat');
    expect(seat?.state, `${h.id} sits on a claimed seat`).toBe('occupied');
    expect(Math.abs(wrap(h.yaw - seat!.yaw)), `${h.id} faces the seat direction`).toBeLessThan(0.2);
    expect(facing([h.p[0], h.p[2]], h.yaw, FIRE), `${h.id} (seated) looks toward the fire`).toBeLessThan(0.6);
  }
  const talk = st.humans.filter((h) => h.activity === 'talk');
  expect(talk.map((h) => h.id).sort()).toEqual(['c1', 'c2']);
  const [c1, c2] = [at('c1'), at('c2')];
  expect(facing([c1.p[0], c1.p[2]], c1.yaw, [c2.p[0], c2.p[2]]), 'c1 faces c2').toBeLessThan(0.2);
  expect(facing([c2.p[0], c2.p[2]], c2.yaw, [c1.p[0], c1.p[2]]), 'c2 faces c1').toBeLessThan(0.2);
  for (let i = 0; i < st.humans.length; i++)
    for (let j = i + 1; j < st.humans.length; j++) {
      const a = st.humans[i].p, b = st.humans[j].p;
      expect(Math.hypot(a[0] - b[0], a[2] - b[2]), `${st.humans[i].id}/${st.humans[j].id} do not overlap`).toBeGreaterThanOrEqual(0.56 - 1e-6);
    }
  return { warm: warm.length, sit: st.humans.filter((x) => x.activity === 'sit').length, talk: talk.length };
}

test('lab campfire-evening: social verbs, expected conflict, pre-emption, zero violations, captures', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const errors = collectConsoleErrors(page);
  await openLab(page, 'campfire-evening');
  await page.addStyleTag({ content: '.lab-perf { visibility: hidden }' });
  expect(await page.getByRole('combobox', { name: 'Scenario' }).inputValue()).toBe('campfire-evening');
  await expect(page.getByRole('combobox', { name: 'Scenario' }).locator('option:checked')).toHaveText(/HYPOTHETICAL/);
  await page.evaluate(() => window.__marsEngine!.runScenario('campfire-evening', { paused: true }));

  // 20 s: 6 round the fire, 2 on chairs, the pair talking, 2 wandering
  const t20 = await step(page, 400);
  expect(await arrangement(page, t20)).toEqual({ warm: 6, sit: 2, talk: 2 });
  await expect(page.getByTestId('social-hud')).toContainText('Idle');
  await labFrames(page);
  await shots(page, 'lab-social-t20', testInfo);

  // 65 s: s1 joined, x1 took the last place, x2 was refused (expected) and sits on the bench, g1 pulled away.
  // (Was 60 s. Since W4's walk timing (9e1c2f4: immediate block reaction, splined turns) x1 — submitted at
  // 42 s — reaches its fire place at tick 1266 = 63.3 s: its walk_to waits 3.5 s (ticks 1030–1100,
  // `traffic.person: x1 is waiting for g3 to move out of the way` — g3 stands warm in the ring), replans
  // at 1109 (12.3 → 5.6 m), waits briefly for g2, and arrives; everyone else is in place by 60 s. The
  // arrival is late, not missing, so the check moved to 65 s. W9 investigation, POSES.md / PROGRESS.)
  const t65 = await step(page, 900);
  expect(await arrangement(page, t65)).toEqual({ warm: 7, sit: 2, talk: 2 });
  expect(t65.humans.find((h) => h.id === 'g1')!.activity).toBe('idle');
  await expect(page.getByRole('alert').filter({ hasText: 'EXPECTED CONFLICT' })).toHaveCount(2);
  await labFrames(page);
  await shots(page, 'lab-social-t65', testInfo);
  // close-ups (capture only): the pair in profile from the south, the circle from the west, the chairs from the north-east
  const close: [string, number[], number[]][] = [
    ['pair', [-16.5, 1.6, -30.2], [-16.5, 1.0, -26.5]],
    ['circle', [-26.8, 2.6, -22.5], [-22, 0.8, -22.5]],
    ['chairs', [-17.2, 2.0, -16.6], [-20.8, 0.6, -20.2]],
    ['chairs-top', [-20.6, 7, -19.99], [-20.6, 0, -20]],
  ];
  for (const [name, pos, target] of close) {
    await page.evaluate(([p, t]) => window.__marsEngine!.camera(p, t), [pos, target]);
    await labFrames(page);
    await captureView(page, `lab-social-t65-close-${name}`, { testInfo, compare: false });
  }

  const end = await page.evaluate(() => window.__marsEngine!.runToEnd());
  expect(end.done).toBe(true);
  for (const c of end.checks) expect(c.ok, c.message).toBe(true);
  expect(await page.evaluate(() => window.__marsEngine!.violations())).toEqual([]);
  const social = (await ext(page).social())!;
  const full = social.fired.find((f) => f.id === 'full')!.recs;
  expect(full.map((r) => r.code)).toEqual(['slot.none-free', 'reservation.conflict']);
  expect(social.notes.every((n) => n.level === 'warn' && n.text.startsWith('EXPECTED')), JSON.stringify(social.notes)).toBe(true);
  console.log(`[lab-social] expected diagnostics:\n  ${social.notes.map((n) => n.text).join('\n  ')}`);
  // every non-expected record is completed or still holding its activity; failures only where scripted
  const records = await page.evaluate(() => window.__marsEngine!.records());
  const expectedIds = new Set(full.map((r) => r.id));
  for (const r of records) if (r.status === 'failed') expect(expectedIds.has(r.id), `${r.id} failed unexpectedly: ${r.diagnostic?.message}`).toBe(true);
  await expect(page.getByRole('alert').filter({ hasText: 'FAILED' })).toHaveCount(0);
  await expect(page.getByTestId('lab-verdict')).toHaveText('Scenario expectations met');

  // deterministic replay
  const hash = await page.evaluate(() => window.__marsEngine!.stateHash());
  await page.evaluate(() => window.__marsEngine!.runScenario('campfire-evening', { paused: true }));
  await page.evaluate(() => window.__marsEngine!.runToEnd());
  expect(await page.evaluate(() => window.__marsEngine!.stateHash())).toBe(hash);
  expect(errors, 'console/page errors').toEqual([]);
});
