// F3 (rehearsal item 17): a god's world keeps time. Launcher worlds run without ENABLE_LIVING_WORLD (no LivingWorld:
// no quiet hours, camp, or day-turn events), so nothing ever logged the `dayConfig` rules event the live worlds get from
// LivingWorld.install: the engine's render clock was never configured and env.datetime stayed at its genesis value, so
// Eyes said "16:00, day" for good and observe had no world.time. Here the world logs that same event itself — the
// existing release's mechanism, replayed like any rules event — with the god's `time.dayTicks` (default 72000 = one
// world day per real hour at 20 ticks/s). When the god changes dayTicks, a new dayConfig keeps the time of day
// continuous (the origin is moved so the phase is unchanged). Edge minds: the brain runs nothing on a clock.
import type { WorldHost } from '../world.ts';
import type { GodMode } from './god.ts';

/** The rules payload that (re)starts the clock at `tick` with `dayTicks`, continuing from `prev` when given. */
export function clockConfig(tick: number, dayTicks: number, prev?: { origin: number; dayTicks: number }) {
  const elapsed = prev ? ((tick - prev.origin) / prev.dayTicks) * dayTicks : 0;
  return { dayConfig: { origin: Math.max(0, Math.round(tick - elapsed)), dayTicks, customs: [] as string[] }, why: `world clock: one world day every ${dayTicks} ticks (the god's time.dayTicks)` };
}

export function installWorldClock(host: WorldHost, god: GodMode, log: (m: string) => void = () => {}) {
  const want = () => { const d = Number(god.model.state.time?.dayTicks); return Number.isSafeInteger(d) && d >= 1200 && d <= 20_000_000 ? d : 72000; };
  let pending = false;
  const sync = () => {
    if (pending) return;
    const l = host.living, d = want();
    if (l && l.dayTicks === d) return;
    pending = true;
    host.enqueue('rules', 'world', clockConfig(host.engine.world.tick, d, l)).catch((e: Error) => log(`world clock: ${e.message}`)).finally(() => { pending = false; });
  };
  sync();
  god.onCommit(() => sync());
}
