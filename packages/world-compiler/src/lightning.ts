// GOD-ENV: lightning in a god's storm, the same for everyone. Strikes are a pure function of the world (seed, bounds),
// the storm's intensity and the world tick, so every viewer draws the same bolt at the same moment in the same place
// and the server can tell a Soul "lightning struck 300 m north-east, the thunder came a second later". The god can also
// strike a point on purpose (`weather.strike`, a `world` op: in the ledger like any other edit).
//
// Arithmetic: + − × ÷ and Math.imul only (bit-identical in the server and the browser).

export type Strike = { tick: number; x: number; z: number; power: number; god?: boolean };
/** Ticks per strike cell (20 ticks/s → one chance every 6 s). */
export const STRIKE_CELL = 120;
/** The speed of sound (m/s): thunder arrives `distance / SOUND_MPS` seconds after the flash. */
export const SOUND_MPS = 343;
/** How long (ticks) a god's strike stays "now" for a viewer that receives it late (a slow socket): 10 s. */
export const STRIKE_FRESH = 200;

function h32(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
function mix(a: number, b: number): number { let h = Math.imul(a ^ (b + 0x9e3779b9), 0x85ebca6b) >>> 0; h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0; return (h ^ (h >>> 16)) >>> 0; }
import { WEATHER_RULES } from './weather-rules.ts';
const u01 = (h: number) => h / 4294967296;

/** The storm's own strikes with ticks in [t0, t1): at most one per cell, more likely the stronger the storm, somewhere
 *  over the world (bounds [x0, z0, x1, z1], trimmed to within `reach` m of its middle so they fall where people are). */
export function stormStrikes(seed: string, bounds: readonly number[], intensity: number, t0: number, t1: number, reach = 450): Strike[] {
  if (!(intensity > 0) || t1 <= t0) return [];
  const out: Strike[] = [], base = h32(`${seed}:lightning`);
  const cx = (bounds[0] + bounds[2]) / 2, cz = (bounds[1] + bounds[3]) / 2;
  const hx = Math.min((bounds[2] - bounds[0]) / 2, reach), hz = Math.min((bounds[3] - bounds[1]) / 2, reach);
  for (let c = Math.floor(t0 / STRIKE_CELL); c * STRIKE_CELL < t1; c++) {
    const h = mix(base, c);
    if (u01(h) >= WEATHER_RULES.strikeChance * intensity) continue;
    const tick = c * STRIKE_CELL + Math.floor(u01(mix(h, 1)) * STRIKE_CELL);
    if (tick < t0 || tick >= t1) continue;
    out.push({ tick, x: Math.round((cx + (u01(mix(h, 2)) * 2 - 1) * hx) * 10) / 10, z: Math.round((cz + (u01(mix(h, 3)) * 2 - 1) * hz) * 10) / 10, power: 0.6 + 0.4 * u01(mix(h, 4)) });
  }
  return out;
}

/** Every strike in [t0, t1): the storm's (when the god's weather is a storm) and the god's own (`weather.strike`). */
export function strikesBetween(state: { weather?: { kind?: string; intensity?: number; until?: number | null; strike?: { x: number; z: number; n: number; tick: number } | null } }, seed: string, bounds: readonly number[], t0: number, t1: number): Strike[] {
  // WEATHER-RULES: only a storm in force strikes, and never past its end
  const w = state.weather ?? {}, out = w.kind === 'storm' && typeof w.until === 'number' ? stormStrikes(seed, bounds, w.intensity ?? 1, t0, Math.min(t1, w.until)) : [];
  const g = w.strike; if (g && g.tick >= t0 && g.tick < t1) out.push({ tick: g.tick, x: g.x, z: g.z, power: 1, god: true });
  return out.sort((a, b) => a.tick - b.tick);
}
