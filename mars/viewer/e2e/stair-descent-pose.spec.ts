import { test, expect } from '@playwright/test';
import { openLab, labFrames } from './lab-helpers';
import { captureView, collectConsoleErrors } from './helpers';

type PoseSample = { tick: number; u: number; weight: number; yaw: number; feet: number[][]; p: number[]; template: string };
type ProofWindow = Window & { __stairPoseProof?: { samples: PoseSample[]; done: boolean } };
type PoseHook = { bones(id: string): Record<string, { feet: number[][]; template: string; gait: { u: number; weight: number } | null }> };

for (const [scenario, direction] of [['stairs', 'ascent'], ['deck-to-ground', 'descent']] as const) {
  test(`current rig keeps anatomical foot sides during actual Play ${direction}`, async ({ page }, testInfo) => {
    const errors = collectConsoleErrors(page);
    await openLab(page, scenario);
    await page.evaluate(name => window.__marsEngine!.runScenario(name, { paused: true, speed: 1 }), scenario);
    await page.evaluate(() => {
      const proof = { samples: [] as PoseSample[], done: false };
      (window as ProofWindow).__stairPoseProof = proof;
      let last = -1;
      const sample = () => {
        const h = window.__marsEngine!, state = h.state();
        if (state.tick !== last) {
          last = state.tick;
          const human = state.humans.find(q => q.id === 'p1')!;
          const bones = (h as unknown as PoseHook).bones('p1').p1;
          if (bones.gait && bones.gait.weight >= .999) proof.samples.push({ tick: state.tick, u: bones.gait.u, weight: bones.gait.weight, yaw: human.yaw, p: human.p, feet: bones.feet, template: bones.template });
        }
        proof.done = state.done;
        if (!proof.done) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForFunction(() => (window as ProofWindow).__stairPoseProof!.samples.some(s => s.u > 6 && s.u < 10), null, { timeout: 60_000 });
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const middle = await page.evaluate(() => window.__marsEngine!.state().humans.find(q => q.id === 'p1')!);
    const forward = direction === 'ascent' ? 1 : -1;
    await page.evaluate(([p, f]) => window.__marsEngine!.camera([p[0] + 2.7 * f, p[1] + 1.1, p[2] + 2.4], [p[0], p[1] + .75, p[2]]), [middle.p, forward] as const);
    await labFrames(page, 3);
    await captureView(page, `stair-${direction}-anatomical-feet`, { compare: false, testInfo });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForFunction(() => (window as ProofWindow).__stairPoseProof!.done, null, { timeout: 60_000 });
    const proof = await page.evaluate(() => (window as ProofWindow).__stairPoseProof!);
    expect(proof.samples.length).toBeGreaterThan(40);
    let closestLeft = -Infinity, closestRight = Infinity;
    for (const sample of proof.samples) {
      const right = [-Math.sin(sample.yaw), Math.cos(sample.yaw)];
      const dot = (foot: number[]) => (foot[0] - sample.p[0]) * right[0] + (foot[2] - sample.p[2]) * right[1];
      const left = dot(sample.feet[0]), physicalRight = dot(sample.feet[1]);
      closestLeft = Math.max(closestLeft, left); closestRight = Math.min(closestRight, physicalRight);
      expect(left, `physical left at tick${sample.tick} u${sample.u}`).toBeLessThan(-.04);
      expect(physicalRight, `physical right at tick${sample.tick} u${sample.u}`).toBeGreaterThan(.04);
    }
    console.log(`[stair ${direction} side ordering] samples${proof.samples.length}; closestLeft${closestLeft.toFixed(4)}; closestRight${closestRight.toFixed(4)}; template${proof.samples[0].template}`);
    expect(await page.evaluate(() => window.__marsEngine!.violations())).toEqual([]);
    expect((await page.evaluate(() => window.__marsEngine!.state().checks)).every(c => c.ok)).toBe(true);
    expect(errors).toEqual([]);
    await testInfo.attach('actual-play-foot-sides', { body: JSON.stringify(proof, null, 2), contentType: 'application/json' });
  });
}
