// Measurement-only preload (node --import): wraps the capability path of a real main.ts server without editing it,
// and appends one JSON line per event to $CAPSTALL_OUT.
//   gap     the event loop did not run for `ms` (a timer set to fire every 2 ms ran late; t = when it resumed)
//   binds   one EdgeLedger.binds(): ms, whether the per-tick cache answered it, and where the miss spent its time
//           (GodNav.capabilities, GodNav.goal, engine standableNearV1/reachV1/clearSpotsV1 call counts and ms)
//   act     the synchronous part of EdgeLedger.act() (until the promise is returned) and its total
//   ground  one Spatial grid build for a point no paged window holds (ground.gridsOver): count and ms
// Module instances are shared with main.ts (same file URLs), so wrapping the prototypes here wraps the live ones.
import {appendFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';

const out = process.env.CAPSTALL_OUT;
if (!out) throw new Error('CAPSTALL_OUT is required');
const rec = (o) => appendFileSync(out, JSON.stringify({t: Date.now(), ...o}) + '\n');
const root = process.env.CAPSTALL_ROOT ? new URL('file://' + process.env.CAPSTALL_ROOT.replace(/\/?$/, '/')) : new URL('../../', import.meta.url);
const imp = (p) => import(new URL(p, root).href);

let last = performance.now();
setInterval(() => { const n = performance.now(), gap = n - last - 2; last = n; if (gap >= 20) rec({k: 'gap', ms: +gap.toFixed(1)}); }, 2).unref();

const r1 = (v) => Math.round(v * 10) / 10;
let frame = null;                                   // accumulator for the binds() call in progress
const add = (key, ms) => { if (frame) { frame[key + 'Ms'] = (frame[key + 'Ms'] ?? 0) + ms; frame[key + 'N'] = (frame[key + 'N'] ?? 0) + 1; } };
const timed = (proto, name, key) => {
  const orig = proto[name]; if (typeof orig !== 'function') throw new Error(`cannot wrap ${key}`);
  proto[name] = function (...a) { const t0 = performance.now(); try { return orig.apply(this, a); } finally { add(key, performance.now() - t0); } };
};

const {EdgeLedger} = await imp('apps/server/src/edge/ledger/ledger.ts');
const {GodNav} = await imp('apps/server/src/god/nav.ts');
const {EngineBridge} = await imp('apps/server/src/god/engine-bridge.ts');
const {MarsEngine} = await imp('packages/engine-mars/src/engine.ts');

timed(GodNav.prototype, 'capabilities', 'nav');
timed(GodNav.prototype, 'goal', 'goal');
timed(GodNav.prototype, 'roomGoal', 'roomGoal');
timed(EngineBridge.prototype, 'capabilities', 'bridge');
timed(MarsEngine.prototype, 'standableNearV1', 'standable');
timed(MarsEngine.prototype, 'reachV1', 'reach');
timed(MarsEngine.prototype, 'clearSpotsV1', 'clearSpots');
{ // canPerform: count, time and the dearest label inside one binds() (the route checks a listing still makes)
  const orig = MarsEngine.prototype.canPerform;
  MarsEngine.prototype.canPerform = function (req, ...a) {
    const t0 = performance.now();
    try { return orig.call(this, req, ...a); }
    finally { const ms = performance.now() - t0; add('canPerform', ms); if (frame && ms > (frame.canPerformTopMs ?? 0)) { frame.canPerformTopMs = ms; frame.canPerformTop = String(req?.label ?? '').slice(0, 60) + ' [' + (req?.steps ?? []).map((s) => s.verb).join(',').slice(0, 60) + ']'; } }
  };
}

const binds = EdgeLedger.prototype.binds;
EdgeLedger.prototype.binds = function (soul) {
  const tick = this.host.engine.world.tick, hit = this.capCache.get(soul.soulId)?.tick === tick;
  if (frame) return binds.call(this, soul);          // nested call: counted in the outer frame
  frame = {};
  const t0 = performance.now(), c0 = process.cpuUsage();
  try { return binds.call(this, soul); }
  finally {
    const ms = performance.now() - t0, f = frame, c = process.cpuUsage(c0); frame = null;
    // cpuMs: CPU time the process spent during the call (a busy machine stretches wall-clock ms, not this)
    const o = {k: 'binds', ms: r1(ms), cpuMs: r1((c.user + c.system) / 1000), hit, tick, soul: soul.soulId.slice(0, 8)};
    for (const [key, v] of Object.entries(f)) o[key] = typeof v === 'number' && key.endsWith('Ms') ? r1(v) : v;
    rec(o);
  }
};

const act = EdgeLedger.prototype.act;
EdgeLedger.prototype.act = function (soul, input) {
  const t0 = performance.now(), tick = this.host.engine.world.tick;
  const p = act.call(this, soul, input), syncMs = performance.now() - t0;
  return p.then((r) => { rec({k: 'act', capability: input?.capability ?? input?.verb, syncMs: r1(syncMs), totalMs: r1(performance.now() - t0), tick, accepted: r?.accepted === true, code: r?.code}); return r; });
};

// Spatial grid builds triggered by levelAt() on a point outside every paged window (the W4b "grids for unrelated destinations").
const {GroundNav} = await imp('mars/viewer/engine/spatial/tiled.ts').catch(() => ({}));
if (GroundNav?.prototype?.gridsOver) {
  const g = GroundNav.prototype.gridsOver;
  GroundNav.prototype.gridsOver = function (...a) {
    const t0 = performance.now(), caller = /at (?:\w+\.)?(\w+) /.exec(new Error().stack.split('\n')[2] ?? '')?.[1] ?? '?';
    try { return g.apply(this, a); } finally { const ms = performance.now() - t0; add('gridsOver', ms); add('gridsOverFrom' + caller, ms); }
  };
}
// the memoised path (a checkout that has GroundNav.levelOver): upper-level builds for tiles no window holds
if (GroundNav?.prototype?.levelOver) {
  const lo = GroundNav.prototype.levelOver;
  GroundNav.prototype.levelOver = function (...a) { const t0 = performance.now(), n0 = this.stats.levelBuilds; try { return lo.apply(this, a); } finally { if (this.stats.levelBuilds > n0) add('levelBuild', performance.now() - t0); } };
}
rec({k: 'preload', pid: process.pid, node: process.version});
