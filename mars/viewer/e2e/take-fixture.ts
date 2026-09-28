// Take-replay FIXTURE for the lab specs (meal.spec.ts, stairs.spec.ts; POSES.md "Take replay").
import type { Page } from '@playwright/test';

type Fields = Record<string, { hands: unknown; baseActivity: string | null; on: string | null }>;
/**
 * Record the running lab scenario with the engine's TakeRecorder for up to `max` ticks and build the
 * FIXTURE: the per-tick human.hands / baseActivity / on that the recorder does not store yet (engine W10
 * adds them), as take change events [t, id, field, value] — the same shape the recorder writes for its
 * own fields (only changes; null when a field goes away). Not real recorder output. Live bones() every
 * `every` ticks for comparison.
 */
export async function recordWithFixture<B>(page: Page, max: number, every: number, who?: string): Promise<{ extra: [number, string, string, unknown][]; live: Record<number, B> }> {
  const start: number = await page.evaluate(() => (window.__marsEngine as unknown as { recordTake(): number }).recordTake());
  return page.evaluate(
    ([start, max, every, who]) => {
      const h = window.__marsEngine! as unknown as { step(n: number): { done: boolean; tick: number }; humanFields(): Fields; bones(id?: string): Record<string, unknown> };
      const extra: [number, string, string, unknown][] = [];
      const last = new Map<string, string>();
      const collect = (t: number) => {
        for (const [id, f] of Object.entries(h.humanFields()))
          for (const k of ['hands', 'baseActivity', 'on'] as const) {
            const v = f[k], s = JSON.stringify(v), key = `${id}/${k}`;
            if (last.get(key) === s || (v === null && !last.has(key))) continue;
            last.set(key, s);
            extra.push([t, id, k, v]);
          }
      };
      collect(0);
      const live: Record<number, Record<string, unknown>> = {};
      for (let i = 0; i < (max as number); i++) {
        const st = h.step(1);
        const t = st.tick - (start as number);
        collect(t);
        if (t % (every as number) === 0) live[t] = h.bones((who as string) || undefined);
        if (st.done) break;
      }
      return { extra, live };
    },
    [start, max, every, who ?? ''] as const,
  ) as Promise<{ extra: [number, string, string, unknown][]; live: Record<number, B> }>;
}

