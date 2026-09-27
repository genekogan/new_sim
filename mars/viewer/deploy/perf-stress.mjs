// Node perf probe for the Engine Lab stress scenario (app/lab/scenarios.ts
// stress(n)): steps it exactly as the lab does (rt.step() then the scenario's
// tick script, timed together) with `rt.profile = true`, then prints tick-cost
// stats, the top profiled costs, the violation count and the final state hash.
//   node deploy/perf-stress.mjs                    # stress-30, 60 s simulated
//   node deploy/perf-stress.mjs --n 30 --seconds 60 --json
//   node deploy/perf-stress.mjs --planner corridor  # opt-in coarse-to-fine planner (routes may differ)
import { fileURLToPath } from 'node:url';
import { stress, buildRuntime } from '../app/lab/scenarios.ts';

export function perfStress({ n = 30, seconds = 60, profile = true, planner = 'exact' } = {}) {
  const s = stress(n);
  const rt = buildRuntime(s);
  rt.services.spatial.planner = planner;
  rt.profile = profile;
  s.start(rt);
  const ticks = Math.round(seconds * 20);
  const costs = [];
  for (let i = 0; i < ticks; i++) {
    const t0 = performance.now();
    rt.step();
    s.tick?.(rt);
    costs.push(performance.now() - t0);
  }
  const sorted = [...costs].sort((a, b) => a - b);
  const q = (f) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))];
  const worst = costs.map((c, i) => [i + 1, c]).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return {
    scenario: s.name,
    planner,
    ticks,
    meanMs: costs.reduce((a, b) => a + b, 0) / ticks,
    p95Ms: q(0.95),
    p99Ms: q(0.99),
    maxMs: sorted[sorted.length - 1],
    worstTicks: worst.map(([t, c]) => ({ tick: t, ms: +c.toFixed(2) })),
    violations: rt.violations.length,
    actions: rt.records.size,
    top: rt.prof ? rt.prof.report().slice(0, 12) : [],
    stateHash: rt.stateHash(),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => {
    const i = process.argv.indexOf(`--${k}`);
    return i > 0 ? Number(process.argv[i + 1]) : d;
  };
  const pi = process.argv.indexOf('--planner');
  const r = perfStress({ n: arg('n', 30), seconds: arg('seconds', 60), planner: pi > 0 ? process.argv[pi + 1] : 'exact' });
  if (process.argv.includes('--json')) console.log(JSON.stringify(r));
  else {
    const f = (x) => `${x.toFixed(2)} ms`;
    console.log(`${r.scenario} (${r.planner} planner): ${r.ticks} ticks, ${r.actions} actions, ${r.violations} violations`);
    console.log(`tick  mean ${f(r.meanMs)}  p95 ${f(r.p95Ms)}  p99 ${f(r.p99Ms)}  max ${f(r.maxMs)}`);
    console.log(`worst ticks: ${r.worstTicks.map((w) => `#${w.tick} ${w.ms} ms`).join(', ')}`);
    console.log('top costs (inclusive; spatial.route includes spatial.sync):');
    for (const t of r.top) console.log(`  ${t.key.padEnd(24)} ${t.ms.toFixed(1).padStart(9)} ms  ${String(t.calls).padStart(7)} calls  max ${t.max.toFixed(2)} ms`);
    console.log(`stateHash ${r.stateHash}`);
  }
}
