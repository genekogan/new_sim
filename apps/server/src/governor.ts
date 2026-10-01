// Spend governor. The daily budget is split into per-tier shares, and each
// share refills a token bucket continuously (share / 24 h). A call runs only if
// its tier's bucket can cover its estimated cost, so spend is spread evenly
// over the day instead of being exhausted in the morning. A hard rolling-24h
// cap on the total stays as a backstop.
export type Tier = 'mid' | 'narrator' | 'director' | 'user' | 'talk';
/** user = compiling wishes, translate, on-demand shots (people clicking), reserved so it always works. talk = rendering speech. */
export const SHARES: Record<Tier, number> = { mid: 0.35, narrator: 0.2, director: 0.05, user: 0.15, talk: 0.25 };
const DAY_MS = 24 * 3600 * 1000;
const CAPACITY_HOURS = 1; // a bucket holds at most one hour of its refill (allows short bursts)

export type BucketView = { tier: Tier; share: number; perDay: number; level: number; capacity: number; estCost: number; denied: number };

export class Governor {
  budget: number;
  private level: Record<Tier, number>;
  private last = Date.now();
  private est: Record<Tier, number> = { mid: 0.00008, narrator: 0.004, director: 0.00005, user: 0.008, talk: 0.0006 };
  denied: Record<Tier, number> = { mid: 0, narrator: 0, director: 0, user: 0, talk: 0 };

  constructor(budgetPerDay: number) {
    this.budget = budgetPerDay;
    // Background tiers start at 15 minutes of refill (no burst after a restart); tiers a person triggers start full.
    this.level = Object.fromEntries((Object.keys(SHARES) as Tier[]).map((t) => [t, t === 'user' || t === 'talk' ? this.capacity(t) : Math.max(this.perDay(t) * (15 / 1440), this.est[t])])) as Record<Tier, number>;
  }
  perDay(t: Tier) { return this.budget * SHARES[t]; }
  /** A bucket holds an hour of refill, and never less than three typical calls (otherwise a tier whose calls cost more than an hour of its refill could never run). */
  capacity(t: Tier) { return Math.max(this.perDay(t) * (CAPACITY_HOURS / 24), 3 * this.est[t]); }
  setBudget(b: number) { this.refill(); const r = b / (this.budget || 1); this.budget = b; for (const t of Object.keys(this.level) as Tier[]) this.level[t] = Math.min(this.level[t] * r, this.capacity(t)); }

  private refill() {
    const now = Date.now(), dt = now - this.last; this.last = now;
    for (const t of Object.keys(this.level) as Tier[]) this.level[t] = Math.min(this.capacity(t), this.level[t] + (this.perDay(t) * dt) / DAY_MS);
  }
  /** May a call of this tier run now? (Checks against a running estimate of its cost.) */
  allow(t: Tier): boolean {
    this.refill();
    if (this.level[t] >= this.est[t]) return true;
    this.denied[t]++;
    return false;
  }
  /** Charge the actual cost after the call, and learn the typical cost of this tier. */
  charge(t: Tier, cost: number) {
    this.refill();
    this.level[t] -= cost;
    if (cost > 0) this.est[t] = this.est[t] * 0.8 + cost * 0.2;
  }
  /** Seconds until this tier can afford another call (for scheduling). */
  waitSeconds(t: Tier): number {
    this.refill();
    const short = this.est[t] - this.level[t];
    return short <= 0 ? 0 : Math.ceil((short * DAY_MS) / this.perDay(t) / 1000);
  }
  view(): BucketView[] {
    this.refill();
    return (Object.keys(SHARES) as Tier[]).map((t) => ({ tier: t, share: SHARES[t], perDay: this.perDay(t), level: this.level[t], capacity: this.capacity(t), estCost: this.est[t], denied: this.denied[t] }));
  }
}
export const tierOf = (callTier: string): Tier => (callTier === 'mid' || callTier === 'attune' ? 'mid' : callTier === 'narrator' ? 'narrator' : callTier === 'director' ? 'director' : callTier === 'talk' ? 'talk' : 'user');
