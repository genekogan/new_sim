/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
declare global { interface Window { __marsEngine: EngineHook } }
const artifacts = path.resolve('e2e/artifacts', process.env.E2E_RUN ?? 'sleep');
for (const [scenario, actor, rig] of [['ground-sleep','sleeper','woman'], ['ground-sleep-rotated','visitor','casual']] as const) {
  test(`${scenario}: actual supported lie/rest/wake, retained interruption, replay and reset`, async ({ page }) => {
    mkdirSync(artifacts, { recursive: true });
    const errors: string[]=[]; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`/lab?scenario=${scenario}`);
    await page.waitForFunction(() => window.__marsEngine?.ready);
    await page.evaluate(name => window.__marsEngine.runScenario(name, { paused: true, speed: 2 }), scenario);
    const button = (name: string) => page.getByRole('button', { name, exact: true });
    await button('Step').click();
    expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual([]);
    await page.evaluate(() => window.__marsEngine.recordTake());
    await button('Start sleep').click(); await button('Play').click();
    await page.waitForFunction(id => { const b=window.__marsEngine.bones(id)[id]; return b?.activity==='sleep-lie-down' && !!b.prone && b.prone.r>1 && b.prone.r<2; }, actor);
    await button('Pause').click();
    await page.screenshot({ path:path.join(artifacts,`${scenario}-lying-transition.png`) });
    await button('Play').click();
    await page.waitForFunction(() => { const s=window.__marsEngine.sleep(); return s?.mode==='sleeping' && s.elapsed>=2; });
    await button('Pause').click();
    const flat = await page.evaluate(id => ({ state:window.__marsEngine.state(), sleep:window.__marsEngine.sleep(), bones:window.__marsEngine.bones(id)[id], mesh:window.__marsEngine.meshPoints(id,3), violations:window.__marsEngine.violations() }), actor);
    expect(flat.sleep?.bindings.actor).toBe(actor); expect(flat.bones.template).toBe(rig);
    expect(flat.violations).toEqual([]); expect(flat.bones.prone?.r).toBe(0);
    // Bounded major-volume standard at this viewing distance; no finger/clothing certification.
    const major = flat.mesh.filter(q => ['torso','head','arm','leg'].includes(q.part));
    expect(major.length).toBeGreaterThan(100);
    expect(Math.min(...major.map(q => q.p[1]))).toBeGreaterThanOrEqual(-0.03);
    for (const arm of flat.bones.arms) expect(arm.source).toBe('sleep');
    const restTick=flat.state.tick;
    writeFileSync(path.join(artifacts,`${scenario}-flat.json`),JSON.stringify(flat,null,2));
    await page.screenshot({ path:path.join(artifacts,`${scenario}-rest.png`) });
    await button('Pause sleep').click(); await button('Play').click();
    await page.waitForFunction(id => { const b=window.__marsEngine.bones(id)[id]; return b?.activity==='sleep-wake-up' && !!b.prone && b.prone.r>1 && b.prone.r<2; }, actor);
    await button('Pause').click();
    await page.screenshot({ path:path.join(artifacts,`${scenario}-waking-transition.png`) });
    await button('Play').click();
    await page.waitForFunction(() => window.__marsEngine.sleep()?.mode==='paused');
    await button('Pause').click();
    const paused = await page.evaluate(() => window.__marsEngine.sleep());
    expect(paused?.elapsed).toBeGreaterThanOrEqual(flat.sleep!.elapsed);
    expect(paused!.remaining).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual([]);
    await page.screenshot({ path:path.join(artifacts,`${scenario}-interrupted-upright.png`) });
    await button('Resume same sleep').click(); await button('Play').click();
    await page.waitForFunction(() => window.__marsEngine.sleep()?.mode==='completed');
    await button('Pause').click();
    const complete = await page.evaluate(() => window.__marsEngine.sleep());
    expect(complete?.action).toBe(flat.sleep!.action); expect(complete?.elapsed).toBe(18);
    expect(complete?.remaining).toBe(0);
    expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual([]);
    await page.screenshot({ path:path.join(artifacts,`${scenario}-completed-return.png`) });
    const replay = await page.evaluate(tick => window.__marsEngine.replayTake([], tick/20, true),restTick);
    expect(replay.bones[actor].template).toBe(rig); expect(replay.bones[actor].prone?.r).toBe(0);
    await page.screenshot({ path:path.join(artifacts,`${scenario}-replay-rest.png`) });
    await page.evaluate(() => window.__marsEngine.endReplay());
    const counts: { geometries:number; textures:number }[]=[];
    for(let n=0;n<3;n++) {
      await button('Reset').click(); await button('Step').click();
      await page.waitForFunction(() => window.__marsEngine.ready);
      await expect.poll(() => page.evaluate(() => window.__marsEngine.state().tick)).toBe(1);
      const info=await page.evaluate(() => window.__marsEngine.info());
      counts.push({geometries:info.geometries,textures:info.textures});
      expect(await page.evaluate(() => window.__marsEngine.sleep())).toBeUndefined();
      expect(await page.evaluate(() => window.__marsEngine.violations())).toEqual([]);
    }
    expect(counts[1]).toEqual(counts[0]); expect(counts[2]).toEqual(counts[0]); expect(errors).toEqual([]);
    writeFileSync(path.join(artifacts,`${scenario}-retention-replay-resources.json`),JSON.stringify({flat:flat.sleep,paused,complete,counts},null,2));
  });
}
