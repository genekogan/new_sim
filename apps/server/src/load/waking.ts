// Waking limit (design §1.4, LOAD-CONTRACT §6): DARK — only with SIM_WAKING_LIMIT=1 (Gene's decision, tranche §5.1).
// When a world is over capacity, a connected Soul past the limit waits its turn with its body asleep where it is (no
// travel; sleep is the only inactivity). Its listen still delivers owner messages and cheap reads still answer; its acts
// answer `world.crowded` {position, eta_s}. FIFO; at most one awake Soul per account while others wait; the world's owner
// never waits; an idle Soul lends its slot (only `awake` bodies count). It queues; it never chooses for a Soul.
import type {Level} from './shared.ts';

export type WakingSoul = {soulId: string; owner: string};
export type WakingView = {awake: (soulId: string) => boolean; souls: () => WakingSoul[]};
export const SLOT_ETA_S = 180, STALE_MS = 10_000;   // a rough minute count per place in line ("about 3 min" for the 1st), until the bench measures it

export class WakingLimit {
  level: Level = 'green';
  private line: string[] = [];
  private at = new Map<string, number>();
  private o: {maxAwake: number; owner: () => string | null; view: WakingView; now?: () => number};
  constructor(o: {maxAwake: number; owner: () => string | null; view: WakingView; now?: () => number}) { this.o = o; }
  /** Load dial: green = maxAwake; amber and above admit no new wakes (the limit is the count awake now). */
  setLoadLevel(level: Level) { this.level = level; }
  /** May this Soul's body wake now? False = it waits in line (and is put in line). */
  mayWake(soulId: string): boolean {
    const souls = this.o.view.souls(), me = souls.find(s => s.soulId === soulId);
    if (!me) return true;
    const owner = this.o.owner();
    if (owner && me.owner === owner) { this.leave(soulId); return true; }
    if (this.o.view.awake(soulId)) { this.leave(soulId); return true; }
    const now = (this.o.now ?? Date.now)();
    // the body rule asks about every connected waiting Soul about once a second: one not asked for 10 s has gone away
    this.line = this.line.filter(id => id === soulId || now - (this.at.get(id) ?? 0) < STALE_MS);
    const awake = souls.filter(s => this.o.view.awake(s.soulId));
    const limit = this.level === 'green' ? this.o.maxAwake : Math.min(this.o.maxAwake, awake.length);
    this.join(soulId);
    if (awake.length >= limit) return false;
    // FIFO, but an account that already has a body awake gives way to other accounts while they wait
    const accountAwake = (o: string) => awake.some(s => s.owner === o);
    const first = this.line.find(id => { const s = souls.find(x => x.soulId === id); return s && !accountAwake(s.owner); }) ?? this.line[0];
    if (first !== soulId) return false;
    this.leave(soulId); return true;
  }
  /** Where this Soul is in line (1 = next), or null if it is not waiting. */
  position(soulId: string): {position: number; eta_s: number} | null {
    const i = this.line.indexOf(soulId); return i < 0 ? null : {position: i + 1, eta_s: (i + 1) * SLOT_ETA_S};
  }
  /** The agent went away: out of line. */
  leave(soulId: string) { const i = this.line.indexOf(soulId); if (i >= 0) this.line.splice(i, 1); this.at.delete(soulId); }
  waiting() { return this.line.length; }
  private join(soulId: string) { if (!this.line.includes(soulId)) this.line.push(soulId); this.at.set(soulId, (this.o.now ?? Date.now)()); }
}

/** The world-words line of a waiting Soul (its card and its own frame say the same thing in first person). */
export function crowdedNote(p: {position: number; eta_s: number}) {
  const nth = p.position === 1 ? '1st' : p.position === 2 ? '2nd' : p.position === 3 ? '3rd' : `${p.position}th`;
  return `Sleeping until the world has room — ${nth} in line (about ${Math.max(1, Math.round(p.eta_s / 60))} min).`;
}
