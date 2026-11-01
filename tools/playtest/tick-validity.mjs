// Harness check H-a (server-reliability tranche, L6): a playtest's verdicts are about the product only if the world was
// ticking at its nominal rate while the Souls played. From /healthz at provision and at close: tick service =
// ticks run / ticks due (20 per wall-clock s, TICK_MS 50; a dilated clock, clockRate < 1, is the starvation itself). Below 0.8 the run is marked infrastructure-invalid:
// a starved host, not a product result (LESSONS-20261026 §1).
export const H_A_MIN_SERVICE = 0.8;
export const NOMINAL_TICKS_PER_S = 20;

/** before/after: healthz bodies with `at` (ms) added by the harness. → {service, valid, ticks, seconds, reason?} */
export function tickValidity(before, after, min = H_A_MIN_SERVICE) {
  if (!before?.ok || !after?.ok || !Number.isFinite(before.tick) || !Number.isFinite(after.tick) || !Number.isFinite(before.at) || !Number.isFinite(after.at))
    return { valid: null, reason: 'healthz before/after missing: tick service not measured' };
  const seconds = (after.at - before.at) / 1000, ticks = after.tick - before.tick;
  if (before.paused || after.paused) return { valid: null, ticks, seconds, reason: 'world paused at provision or close: tick service not judged' };
  if (seconds < 10) return { valid: null, ticks, seconds, reason: 'run shorter than 10 s: tick service not judged' };
  const service = +(ticks / (seconds * NOMINAL_TICKS_PER_S)).toFixed(3);
  const clockRate = after.clockRate ?? null;
  return service >= min ? { valid: true, service, ticks, seconds, clockRate } : { valid: false, service, ticks, seconds, clockRate, reason: `tick service ${service} < ${min}: the world was starved; verdicts reflect the host, not the product` };
}
