// Cross-host determinism probe: rehearses the flagship build-bay sequence on
// open ground (the same recipe as e2e/lab-build-bay.spec.ts rehearsalHash())
// and prints its final-state hash and take id, plus fingerprints of the engine's
// deterministic math (engine/core/math.ts) and of the host's Math.* for
// comparison. Browser / Node / Durable Object must agree on every line except
// the host-math one (that line only shows whether the host differs).
//   node deploy/determinism-probe.mjs          # human-readable
//   node deploy/determinism-probe.mjs --json   # one JSON object
// Other hosts: import { determinismProbe } from this module and compare output.
import { fileURLToPath } from 'node:url';
import { WorldHistory } from '../engine/history/store.ts';
import { Spatial } from '../engine/spatial/service.ts';
import { emptyWorld, addAll } from '../engine/world/factory.ts';
import { bindTemplate } from '../engine/sequence/bind.ts';
import { rehearse } from '../engine/rehearsal/rehearse.ts';
import { hashOf } from '../engine/core/hash.ts';
import { dsin, dcos, dtan, datan2, dasin, dacos, dexp, dlog } from '../engine/core/math.ts';
import { buildBayEntities, buildBayTemplate, buildBayBindings, buildBayRegistry, BUILD_BAY_INVARIANTS, BUILD_BAY_CONTRIBUTORS } from '../engine/scenarios/build-bay.ts';
import { buildBayGround, BUILD_BAY_RULES, BUILD_BAY_SITE } from '../app/lab/build-bay.ts';

/** Hash of the bit patterns of f over a fixed spread of 4096 inputs (pairs for atan2). */
function fingerprint(fns) {
  const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
  const out = [];
  for (let i = 0; i < 4096; i++) {
    const x = (i - 2048) * 0.0137 + i * 1e-7, y = ((i * 7919) % 4096 - 2048) * 0.0091;
    for (const f of fns) {
      f64[0] = f(x, y);
      out.push(u32[0], u32[1]);
    }
  }
  return hashOf(out).slice(0, 16);
}

export function determinismProbe() {
  const h = new WorldHistory(BUILD_BAY_RULES);
  h.publishCanonical('canon', 'open ground', addAll(emptyWorld('open-ground', buildBayGround()), ...buildBayEntities(BUILD_BAY_SITE)), 'probe');
  h.fork('canon', 'ws', 'ws');
  const plan = bindTemplate(buildBayTemplate(BUILD_BAY_SITE), buildBayBindings, { history: h, baseline: 'ws', registry: buildBayRegistry() });
  const r = rehearse(h, 'ws', plan, {
    registry: buildBayRegistry(),
    invariants: BUILD_BAY_INVARIANTS,
    services: () => ({ spatial: new Spatial(buildBayGround(), { contributors: BUILD_BAY_CONTRIBUTORS }) }),
  });
  const u = (x) => Math.abs(x % 2) - 1; // map into [-1, 1] for asin/acos
  return {
    scenario: 'build-bay/open-ground',
    status: r.report.status,
    ticks: r.take.ticks,
    finalStateHash: r.take.finalStateHash,
    takeId: r.take.id,
    engineMath: fingerprint([dsin, dcos, dtan, (x, y) => datan2(y, x), (x) => dasin(u(x)), (x) => dacos(u(x)), (x) => dexp(x / 8), (x) => dlog(Math.abs(x) + 1e-3)]),
    hostMath: fingerprint([Math.sin, Math.cos, Math.tan, (x, y) => Math.atan2(y, x), (x) => Math.asin(u(x)), (x) => Math.acos(u(x)), (x) => Math.exp(x / 8), (x) => Math.log(Math.abs(x) + 1e-3)]),
    host: typeof process !== 'undefined' && process.versions?.node ? `node ${process.versions.node} (v8 ${process.versions.v8})` : (globalThis.navigator?.userAgent ?? 'unknown'),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const p = determinismProbe();
  if (process.argv.includes('--json')) console.log(JSON.stringify(p));
  else for (const [k, v] of Object.entries(p)) console.log(`${k.padEnd(15)} ${v}`);
}
