// Load lane L4 (server-reliability tranche, 2026-10-31): skip the static-world scan while only nav-pure code has run.
//
// Every Spatial.sync outside a readPass scans every static entity (~4,500 in Eden 2026) for a navigation change
// (service.ts navChanged). A walk step syncs once or more, so N walkers scanned the whole world N+1 times a tick
// (L5's replay profile: 39 % of engine.step; ~2 ms a tick with two walkers on the laptop), though a walk step only moves
// its own body. The runtime opens trust while only nav-pure code runs — `walk_to` steps (ActionDef.navPure) and the
// read-only invariant / observer pass — and closes it before and after anything else (between ticks, any other action,
// a walk that finished or failed, admissions). A scan made while trust is open carries the open interval's token; a
// later sync in the same interval, on the same entity table, takes the scan's answer ("no static change") without
// walking the entities again, and still lists the bodies (the windows follow them). The result is exactly the scan's:
// nothing that could change a static entity ran in between. Global (not per runtime): a nested runtime's close only
// invalidates more, never less.
let gen = 0, open = false;
/** Only nav-pure code runs until the next close (the token of the current interval stays valid). */
export function navTrustOpen(): void { open = true; }
/** Anything may run now: every certificate made so far is void. */
export function navTrustClose(): void { gen++; open = false; }
/** The certificate a scan made now carries, or -1 when trust is closed. */
export function navTrustToken(): number { return open ? gen : -1; }
/** Test oracle (SIM_NAV_TRUST_CHECK=1, or setNavTrustCheck): a trusted sync scans anyway and throws if the scan saw a
 *  static change the trust skipped (an action marked navPure that is not). */
let check = typeof process !== 'undefined' && (process as { env?: Record<string, string | undefined> }).env?.SIM_NAV_TRUST_CHECK === '1';
export function setNavTrustCheck(on: boolean): void { check = on; }
export function navTrustChecking(): boolean { return check; }
