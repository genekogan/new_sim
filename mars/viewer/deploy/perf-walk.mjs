// Walker performance + bit-identical proof over the five pinned scenarios (PLANNING_BUDGET.md §6):
// lab stress-30 (60 s), build-bay probe (open ground), campus flagship (staging-east crop), meal, build-bay v3.
// Prints per scenario: final state hash, ticks, compute, tick mean / max, walk_to.step total, worst routeAround.
// Timing is measurement only: `Runtime.prototype.step` is wrapped here (never in engine code) and the spatial
// profiler is attached; neither is read by the simulation, and the hashes are asserted against the pins.
//   node deploy/perf-walk.mjs                 # all five, once
//   node deploy/perf-walk.mjs --only stress,meal --repeat 2 --json
import { fileURLToPath } from 'node:url';
import { Runtime } from '../engine/runtime/runtime.ts';
import { Profiler } from '../engine/runtime/profile.ts';
import { Spatial } from '../engine/spatial/service.ts';
import { WorldHistory } from '../engine/history/store.ts';
import { emptyWorld, addAll } from '../engine/world/factory.ts';
import { bindTemplate } from '../engine/sequence/bind.ts';
import { rehearse } from '../engine/rehearsal/rehearse.ts';
import { buildBayEntities, buildBayTemplate, buildBayBindings, buildBayRegistry, BUILD_BAY_INVARIANTS, BUILD_BAY_CONTRIBUTORS } from '../engine/scenarios/build-bay.ts';
import { buildBayV3Entities, buildBayV3Regions, buildBayV3Template, buildBayV3Bindings, buildBayV3Registry, BUILD_BAY_V3_INVARIANTS, BUILD_BAY_V3_CONTRIBUTORS } from '../engine/scenarios/build-bay-v3.ts';
import { buildBayGround, BUILD_BAY_RULES, BUILD_BAY_SITE } from '../app/lab/build-bay.ts';
import { stress, buildRuntime } from '../app/lab/scenarios.ts';
import { readCampus2026File } from '../engine/campus/node.ts';
import { cropScene } from '../engine/campus/load.ts';
import { CAMPUS_ID, loadCampus2026 } from '../engine/campus/world.ts';
import { mealRuntime, runMeal } from '../engine/scenarios/meal.ts';

/** The pins asserted by the engine tests (planning / grid-incremental / campus-full / meal / build-bay-v3); re-pinned: walker fallback + hypot + encounters on the smoothed path, 2026-09-28. */
export const PINS = {
  stress: '1298e2e57b62adf5fca2b579c5babbfdb743a395134afc432d4797a0c5b5ee6b',
  probe: '0147f8f12a997462f5e6adfe71ffef1a8bc7e850d84082289328111618fd30d5',
  campus: 'fee92ee0a94fc91505be23eb5ccaf19f02f15293ce8630a1b357b482c0240c56',
  meal: '035e8c3949b7404726c93f326430dc59e6728eee5b3596483fd2add39b8baba5',
  v3: '66800edc569a37aa15a879c7525806b72a4c3d61557167e392ef87ccaa2af8d5',
};

// ---- measurement harness (bench only) ----
let costs = [];
let prof = null;
const origStep = Runtime.prototype.step;
Runtime.prototype.step = function (...a) {
  if (prof && this.prof !== prof) this.profile = true, (this.prof = prof), this.services.spatial && (this.services.spatial.prof = prof);
  const t0 = performance.now();
  const r = origStep.apply(this, a);
  costs.push(performance.now() - t0);
  return r;
};

function measured(name, fn) {
  costs = [];
  prof = new Profiler();
  const t0 = performance.now();
  const hash = fn();
  const ms = performance.now() - t0;
  const rows = Object.fromEntries(prof.report().map((r) => [r.key, r]));
  const out = {
    name,
    hash,
    pinned: hash === PINS[name],
    ticks: costs.length,
    computeS: ms / 1000,
    meanMs: costs.reduce((a, b) => a + b, 0) / Math.max(1, costs.length),
    maxMs: Math.max(0, ...costs),
    walkStepS: (rows['walk_to.step']?.ms ?? 0) / 1000,
    walkPlanS: (rows['walk_to.plan']?.ms ?? 0) / 1000,
    routeAround: rows['spatial.routeAround'] ? { calls: rows['spatial.routeAround'].calls, ms: rows['spatial.routeAround'].ms, max: rows['spatial.routeAround'].max } : null,
    top: prof.report().slice(0, 10).map((r) => ({ key: r.key, ms: +r.ms.toFixed(1), calls: r.calls, max: +r.max.toFixed(2) })),
  };
  prof = null;
  return out;
}

const SCENARIOS = {
  stress: () => {
    const s = stress(30);
    const rt = buildRuntime(s);
    rt.services.spatial.planner = 'exact';
    s.start(rt);
    for (let i = 0; i < 1200; i++) {
      rt.step();
      s.tick?.(rt);
    }
    return rt.stateHash();
  },
  probe: () => {
    const h = new WorldHistory(BUILD_BAY_RULES);
    h.publishCanonical('canon', 'open ground', addAll(emptyWorld('open-ground', buildBayGround()), ...buildBayEntities(BUILD_BAY_SITE)), 'probe');
    h.fork('canon', 'ws', 'ws');
    const plan = bindTemplate(buildBayTemplate(BUILD_BAY_SITE), buildBayBindings, { history: h, baseline: 'ws', registry: buildBayRegistry() });
    const r = rehearse(h, 'ws', plan, { registry: buildBayRegistry(), invariants: BUILD_BAY_INVARIANTS, services: () => ({ spatial: new Spatial(buildBayGround(), { contributors: BUILD_BAY_CONTRIBUTORS }) }) });
    if (r.report.status !== 'completed') throw new Error('probe did not complete');
    return r.take.finalStateHash;
  },
  campus: () => {
    const file = readCampus2026File();
    const { base, world } = loadCampus2026(file, { flagshipInventory: false });
    const st = world.regions['staging-east'];
    const xs = st.polygon.map((p) => p[0]), zs = st.polygon.map((p) => p[1]);
    const site = { origin: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2], yaw: 0, groundY: base.meta.groundY };
    const local = cropScene(base, [site.origin[0] - 40, site.origin[1] - 40, site.origin[0] + 40, site.origin[1] + 40]);
    const h = new WorldHistory('mars-rules/flagship-campus-test');
    h.publishCanonical(CAMPUS_ID, 'Mars 2026 (canonical)', world, 'test');
    h.fork(CAMPUS_ID, 'build', 'flagship build (hypothetical)');
    const w = h.read('build');
    for (const e of buildBayEntities(site)) w.entities[e.id] = e;
    h.commit('build', w, { kind: 'design-edit', note: 'flagship piles + crew' });
    const cfg = { registry: buildBayRegistry(), invariants: BUILD_BAY_INVARIANTS, services: () => ({ spatial: new Spatial(local, { contributors: BUILD_BAY_CONTRIBUTORS, baseId: file.contentHash }) }) };
    const plan = bindTemplate(buildBayTemplate(site), buildBayBindings, { history: h, baseline: 'build', registry: buildBayRegistry() });
    const reh = rehearse(h, 'build', plan, cfg);
    if (reh.report.status !== 'completed') throw new Error('campus flagship did not complete');
    return reh.take.finalStateHash;
  },
  meal: () => {
    const rt = mealRuntime();
    runMeal(rt);
    return rt.stateHash();
  },
  v3: () => {
    const site = { origin: [0, 0], yaw: 0 };
    const ground = () => ({ bounds: [-20, -15, 15, 15], levels: [{ id: 0, y: 0, label: 'ground' }], surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [-2.5, 0], half: [17.5, 15], yaw: 0 } }], obstacles: [], links: [] });
    const cfg = { registry: buildBayV3Registry(), invariants: BUILD_BAY_V3_INVARIANTS, services: () => ({ spatial: new Spatial(ground(), { contributors: BUILD_BAY_V3_CONTRIBUTORS }) }) };
    const w = emptyWorld('open-ground', ground());
    for (const e of buildBayV3Entities(site)) w.entities[e.id] = e;
    for (const r of buildBayV3Regions(site)) w.regions[r.id] = r;
    const h = new WorldHistory('mars-rules/flagship-v3-test');
    h.publishCanonical('canon', 'Open ground (canonical fixture)', w, 'flagship v3 fixture');
    h.fork('canon', 'ws', 'build workspace');
    const plan = bindTemplate(buildBayV3Template(site), buildBayV3Bindings, { history: h, baseline: 'ws', registry: buildBayV3Registry() });
    const reh = rehearse(h, 'ws', plan, cfg);
    if (reh.report.status !== 'completed') throw new Error('v3 did not complete');
    return reh.take.finalStateHash;
  },
};

export function perfWalk(only = Object.keys(SCENARIOS), repeat = 1) {
  const out = [];
  for (let k = 0; k < repeat; k++) for (const n of only) out.push(measured(n, SCENARIOS[n]));
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const oi = process.argv.indexOf('--only');
  const ri = process.argv.indexOf('--repeat');
  const res = perfWalk(oi > 0 ? process.argv[oi + 1].split(',') : undefined, ri > 0 ? Number(process.argv[ri + 1]) : 1);
  if (process.argv.includes('--json')) console.log(JSON.stringify(res));
  else
    for (const r of res) {
      const ra = r.routeAround ? `routeAround ${r.routeAround.calls}× ${r.routeAround.ms.toFixed(0)} ms max ${r.routeAround.max.toFixed(1)}` : '';
      console.log(`${r.name.padEnd(7)} ${r.pinned ? 'PIN-OK ' : 'MOVED! '} ${r.hash.slice(0, 12)}  ticks ${r.ticks}  compute ${r.computeS.toFixed(2)} s  tick mean ${r.meanMs.toFixed(3)} max ${r.maxMs.toFixed(1)} ms  walk.step ${r.walkStepS.toFixed(2)} s  ${ra}`);
      if (process.argv.includes('--top')) for (const t of r.top) console.log(`    ${t.key.padEnd(26)} ${String(t.ms).padStart(9)} ms ${String(t.calls).padStart(7)}× max ${t.max}`);
    }
  if (res.some((r) => !r.pinned)) process.exitCode = 1;
}
