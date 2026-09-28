// Take-replay recording for the lab specs (meal.spec.ts, stairs.spec.ts; POSES.md "Take replay").
import type { Page } from '@playwright/test';

/**
 * Record the running lab scenario with the engine's TakeRecorder for up to `max` ticks, with the live bones() every
 * `every` ticks for comparison. The replay then uses the take's OWN recorded human fields: `hands` (integer mm,
 * thinned to keyframes in mars-take/3 and interpolated by sampleTake), `baseActivity`, `on`.
 *
 * `extra` is always empty now. It used to carry a FIXTURE of those fields (metre-valued hands, per tick) from before
 * the recorder stored them; merged into a recorded take it mixed metres with the recorder's millimetres, so it is
 * retired (W19, per W20's mars-take/3 note). The parameter stays so replayTake(extra, t) callers keep working.
 */
export async function recordWithFixture<B>(page: Page, max: number, every: number, who?: string): Promise<{ extra: [number, string, string, unknown][]; live: Record<number, B> }> {
  const start: number = await page.evaluate(() => (window.__marsEngine as unknown as { recordTake(): number }).recordTake());
  return page.evaluate(
    ([start, max, every, who]) => {
      const h = window.__marsEngine! as unknown as { step(n: number): { done: boolean; tick: number }; bones(id?: string): Record<string, unknown> };
      const live: Record<number, Record<string, unknown>> = {};
      for (let i = 0; i < (max as number); i++) {
        const st = h.step(1);
        const t = st.tick - (start as number);
        if (t % (every as number) === 0) live[t] = h.bones((who as string) || undefined);
        if (st.done) break;
      }
      return { extra: [], live };
    },
    [start, max, every, who ?? ''] as const,
  ) as Promise<{ extra: [number, string, string, unknown][]; live: Record<number, B> }>;
}
