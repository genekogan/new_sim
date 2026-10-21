// Clock catch-up (lane SLEEP, 2026-10-21; Gene's open question, coordinator default "jump to now"). A world nobody
// watches runs its clock at a quarter of its wall pace (attention.ts), stops it entirely while the launcher has it
// frozen (SIGSTOP), and has no clock at all while its process is gone (the launcher lets a world asleep for an hour
// exit to give its memory back). When somebody comes back, the world's time of day jumps to where it would be had
// the clock kept wall pace: one `dayConfig` rules event moves the day clock's origin back by the ticks it fell behind.
// Nothing is simulated for the missed time (no catch-up ticks: needs, schedules and bodies are as they were), the
// tick count is unchanged, and the jump is an ordinary logged rules event, so a replay reaches the same state.
//
// The moment the clock fell out of step (the world became unwatched) is kept in <DATA_DIR>/clock-wall.json, so a
// world whose process exited and later cold-boots still knows how long it was away.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { PAUSED_DAY_TICKS } from './god/world-clock.ts';
import type { WorldHost } from './world.ts';

const TICK_MS = 50;
type Anchor = { worldId: string; wall: number; tick: number };

/** Minimum wall time behind before the clock jumps (SIM_CLOCK_CATCHUP_MIN_S, default 60 s; 0 = never jump). */
export function catchUpMinMs(env: Record<string, string | undefined> = process.env): number {
  const v = Number(env.SIM_CLOCK_CATCHUP_MIN_S ?? 60);
  return Number.isFinite(v) && v >= 0 ? v * 1000 : 60_000;
}

/** The rules payload that jumps the day clock `behind` ticks forward (null when there is no running day clock). */
export function catchUpPayload(living: WorldHost['living'] & { anchor?: number } | undefined, behind: number, wallMs: number) {
  if (!living || !(living.dayTicks > 0) || living.dayTicks >= PAUSED_DAY_TICKS || !(behind > 0)) return null;
  const dayConfig = { origin: Math.round(living.origin - behind), dayTicks: living.dayTicks, customs: living.customs ?? [], ...(living.anchor ? { anchor: living.anchor } : {}) };
  return { dayConfig, why: `world clock: caught up ${Math.round(wallMs / 1000)} s nobody was here (jumped to now, nothing simulated)` };
}

export class ClockCatchUp {
  private anchor: Anchor | null = null;
  readonly file: string;
  private host: WorldHost;
  private o: { minMs?: number; now?: () => number; log?: (m: string) => void };
  constructor(host: WorldHost, dataDir: string, o: { minMs?: number; now?: () => number; log?: (m: string) => void } = {}) {
    this.host = host; this.o = o;
    this.file = join(dataDir, 'clock-wall.json');
    try {
      const a = JSON.parse(readFileSync(this.file, 'utf8')) as Anchor | null;
      if (a && a.worldId === host.worldId && Number.isFinite(a.wall) && Number.isSafeInteger(a.tick)) this.anchor = a;
    } catch { /* none yet */ }
  }
  private now() { return this.o.now?.() ?? Date.now(); }
  private save() {
    const tmp = `${this.file}.${process.pid}.tmp`;
    try { writeFileSync(tmp, JSON.stringify(this.anchor) + '\n'); renameSync(tmp, this.file); } catch { /* best effort: a lost anchor only means no jump */ }
  }
  /** Nobody is here any more: from now on the clock falls behind the wall. */
  unwatched() {
    if (this.anchor) return;   // still behind since an earlier moment (a boot that nobody watched)
    this.anchor = { worldId: this.host.worldId, wall: this.now(), tick: this.host.engine.world.tick };
    this.save();
  }
  /** Somebody is here: jump the day clock to now (if it fell behind by at least `minMs` of wall time). */
  watched(): Promise<unknown> | null {
    const a = this.anchor; if (!a) return null;
    this.anchor = null; this.save();
    const wallMs = this.now() - a.wall, rate = this.host.baseRate > 0 ? this.host.baseRate : 1;
    const behind = Math.floor((wallMs / TICK_MS) * rate) - (this.host.engine.world.tick - a.tick);
    const minMs = this.o.minMs ?? catchUpMinMs();
    if (!(minMs > 0) || this.host.paused || (behind * TICK_MS) / rate < minMs) return null;
    const payload = catchUpPayload(this.host.living as never, behind, wallMs);
    if (!payload) return null;
    this.o.log?.(`[clock] caught up ${behind} ticks (${Math.round(wallMs / 1000)} s since nobody was here, ${Math.round((behind * TICK_MS) / rate / 1000)} s behind)`);
    return this.host.enqueue('rules', 'world', payload);
  }
}
