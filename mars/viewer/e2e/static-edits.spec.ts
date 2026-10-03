import { test, expect } from '@playwright/test';
import { captureView, collectConsoleErrors, writeArtifact } from './helpers';
import { openLab, labFrames, setOverlays } from './lab-helpers';

test('static design edits: the browser controller closes and reopens a passage; capture both routes', async ({ page }, testInfo) => {
  const errors = collectConsoleErrors(page);
  await openLab(page);
  const result = await page.evaluate(async () => {
    const apiPath = '/engine/api/index.ts', editsPath = '/engine/spatial/edits.ts', scenariosPath = '/app/lab/scenarios.ts';
    const { createController, seedHistory, ENGINE_SCENES } = await import(/* @vite-ignore */ apiPath);
    const { sceneForWorld } = await import(/* @vite-ignore */ editsPath);
    const { SCENARIOS } = await import(/* @vite-ignore */ scenariosPath);
    const c = createController({ history: seedHistory(), scenes: ENGINE_SCENES });
    c.call('fork', { from: 'proving-ground', name: 'edit-capture' });
    const callEdit = (edits: unknown[]) => c.call('edit_world', { workspace: 'edit-capture', note: 'browser regression', edits });
    const q = () => c.call('query_world', { workspace: 'edit-capture', route: { actor: 'n1', x: 15, z: -12 } });
    const before = q();
    const closed = callEdit([{ op: 'static_add', id: 'gate-wall', kind: 'wall', obb: { c: [15, -15], half: [0.45, 0.1], yaw: 0 }, y0: 0, y1: 2.4 }]);
    const detour = q();
    const register = (name: string) => {
      const world = c.history.read('edit-capture');
      SCENARIOS.push({ name, title: name, description: 'Controller static design edit regression', scene: () => sceneForWorld(ENGINE_SCENES['proving-ground'], world), humans: () => [world.entities.n1],
        start: (rt: { submit: (verb: string, args: unknown) => void }) => rt.submit('walk_to', { actor: 'n1', x: 15, z: -12 }),
        maxTicks: 2000, focus: [15, -15, 12], expect: (rt: { violations: unknown[] }) => [{ ok: rt.violations.length === 0, message: 'zero violations' }] });
    };
    register('static-closed');
    const opened = callEdit([{ op: 'static_remove', id: 'gate-wall' }]);
    const after = q();
    register('static-open');
    return { closed, opened, before, detour, after };
  });
  expect(result.closed.ok).toBe(true);
  expect(result.opened.ok).toBe(true);
  expect(result.detour.route.length).toBeGreaterThan(result.before.route.length + 5);
  expect(result.after.route.length).toBe(result.before.route.length);
  await writeArtifact('static-edits.json', result, testInfo);
  for (const name of ['static-closed', 'static-open']) {
    await page.evaluate((n) => window.__marsEngine!.runScenario(n, { paused: true }), name);
    await page.evaluate(() => { window.__marsEngine!.step(1); window.__marsEngine!.cameraPreset('top'); });
    await setOverlays(page, true);
    await labFrames(page);
    await captureView(page, name, { testInfo, compare: false });
    const end = await page.evaluate(() => window.__marsEngine!.runToEnd(2000));
    expect(end.done).toBe(true);
    expect(await page.evaluate(() => window.__marsEngine!.violations())).toEqual([]);
  }
  expect(errors).toEqual([]);
});
