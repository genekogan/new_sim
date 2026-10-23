// WEATHER-RULES (Gene 2026-10-23: "rain and lightning both tend to last too long and happen too often… does rain time out
// or stay forever?"): the climate rules every world shares. A god's set rain or storm is a SHOWER with an end: the `world`
// op stamps `weather.until` (a world tick) from `weather.minutes` (world minutes; defaults below), and from that tick on the
// world is back on the scheduled weather. The end is a tick in the world state, so it survives a restart from a snapshot;
// a wet setting without an end (set before this rule) has already ended. Lightning falls only inside a storm in force.
export const WEATHER_RULES = {
  /** Default length of a god's rain, in world minutes (24× clock: 90 world min ≈ 3¾ real min). */
  rainMinutes: 90,
  /** Default length of a god's storm (and its lightning), in world minutes. */
  stormMinutes: 45,
  /** The bounds a god can set with `weather.minutes`. */
  minMinutes: 5,
  maxMinutes: 360,
  /** Chance a storm of intensity 1 strikes in one 6 s strike cell (was 0.85: a bolt every ~7 s, for as long as the storm). */
  strikeChance: 0.3,
} as const;

type WeatherLike = { kind?: string; rain?: number; intensity?: number; until?: number | null; minutes?: number } | null | undefined;

/** A setting that rains: rain, storm, or manual channels with rain. */
export const isWetSetting = (w: WeatherLike) => !!w && (w.kind === 'rain' || w.kind === 'storm' || (w.kind === 'manual' && (w.rain ?? 0) > 0.1));

/** World minutes of a wet setting (the god's `minutes`, clamped; else the kind's default). */
export function showerMinutes(w: WeatherLike): number {
  const m = Number(w?.minutes);
  if (Number.isFinite(m) && m > 0) return Math.min(WEATHER_RULES.maxMinutes, Math.max(WEATHER_RULES.minMinutes, m));
  return w?.kind === 'storm' ? WEATHER_RULES.stormMinutes : WEATHER_RULES.rainMinutes;
}

/** The end tick of a wet setting made at `tick` on a clock of `dayTicks` ticks per world day. */
export const showerUntil = (w: WeatherLike, tick: number, dayTicks: number) =>
  Math.round(tick + (showerMinutes(w) * (Number(dayTicks) > 0 ? Number(dayTicks) : 72000)) / 1440);

/** Is the god's set weather in force at `tick`? Dry settings stay until changed; a wet one only before its `until`
 *  (an unknown tick — NaN — trusts a stamped end). 'auto' or nothing set: false (the schedule rules). */
export function setWeatherInForce(w: WeatherLike, tick: number): boolean {
  if (!w?.kind || w.kind === 'auto') return false;
  if (!isWetSetting(w)) return true;
  if (typeof w.until !== 'number') return false;
  return !Number.isFinite(tick) || tick < w.until;
}
