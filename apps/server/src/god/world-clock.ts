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

/** A stopped clock (the god paused time): a day this long never visibly moves (2^40 ticks ≈ 1,700 years at 20/s). */
export const PAUSED_DAY_TICKS = 2 ** 40;
/** World days elapsed at `tick` on a running clock (origin may be negative: R4-LIVE). */
const elapsedDays = (tick: number, c: { origin: number; dayTicks: number }) => Math.max(0, tick - c.origin) / c.dayTicks;

/** R4-LIVE: the rules payload for the god's time state at `tick` — the day length (or paused), and, when the god set the
 *  time of day (`set.hour`, applied once per `set.n`), the clock moved FORWARD to the next such hour (time never runs
 *  back). Without a new set it keeps the time of day continuous. The origin may go negative on a young world (the engine
 *  reads that as more days elapsed). `anchor` records which set this is, so a restart does not apply it again. */
export function envClockConfig(tick: number, want: { dayTicks: number; paused: boolean; set?: { hour: number; n: number } | null }, prev?: { origin: number; dayTicks: number; anchor?: number }) {
  const dayTicks = want.paused ? PAUSED_DAY_TICKS : want.dayTicks;
  let days = prev ? elapsedDays(tick, prev) : 0;
  const anchor = want.set?.n ?? prev?.anchor ?? 0;
  if (want.set && want.set.n !== (prev?.anchor ?? 0)) {
    const whole = Math.floor(days), at = want.set.hour / 24;
    // the base clock reads 06:00 at elapsed 0: hour h is (h - 6) / 24 into a day
    let next = whole + (((at - 0.25) % 1) + 1) % 1;
    if (next < days - 1e-9) next += 1;
    days = next;
  }
  const origin = Math.round(tick - days * dayTicks);
  const why = want.paused ? 'world clock: paused by the god' : want.set && want.set.n !== (prev?.anchor ?? 0) ? `world clock: the god set the time to ${String(Math.floor(want.set.hour)).padStart(2, '0')}:${String(Math.round((want.set.hour % 1) * 60)).padStart(2, '0')}` : `world clock: one world day every ${dayTicks} ticks (the god's time.dayTicks)`;
  return { dayConfig: { origin, dayTicks, customs: [] as string[], anchor }, why };
}

export function installWorldClock(host: WorldHost, god: GodMode, log: (m: string) => void = () => {}) {
  const want = () => {
    const t = god.model.state.time as { dayTicks?: number; paused?: boolean; set?: { hour: number; n: number } | null } | undefined;
    const d = Number(t?.dayTicks);
    return { dayTicks: Number.isSafeInteger(d) && d >= 1200 && d <= 20_000_000 ? d : 72000, paused: t?.paused === true, set: t?.set ?? null };
  };
  let pending = false;
  const sync = () => {
    if (pending) return;
    const l = host.living as (NonNullable<WorldHost['living']> & { anchor?: number }) | undefined, w = want();
    const dayTicks = w.paused ? PAUSED_DAY_TICKS : w.dayTicks, anchor = w.set?.n ?? l?.anchor ?? 0;
    if (l && l.dayTicks === dayTicks && (l.anchor ?? 0) === anchor) return;
    // a world that has never had time set keeps F3's original payload (byte-identical history for the earlier worlds)
    const payload = !w.paused && !w.set && !l?.anchor ? clockConfig(host.engine.world.tick, dayTicks, l) : envClockConfig(host.engine.world.tick, w, l);
    pending = true;
    host.enqueue('rules', 'world', payload).catch((e: Error) => log(`world clock: ${e.message}`)).finally(() => { pending = false; if (want().dayTicks !== w.dayTicks || want().paused !== w.paused || want().set?.n !== w.set?.n) sync(); });
  };
  sync();
  god.onCommit(() => sync());
}
