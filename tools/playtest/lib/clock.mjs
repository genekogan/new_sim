// Run clock: UTC ISO `t` and monotonic `mono` (ms since the run started, or since this process if no anchor was set).
let anchor = performance.now();
export function setAnchor(ms) { anchor = ms; }
export function anchorNow() { return anchor; }
export const now = () => ({ t: new Date().toISOString(), mono: Math.round(performance.now() - anchor) });
export const monoMs = () => Math.round(performance.now() - anchor);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Wait until fn() is truthy or timeout; returns the value or null. */
export async function until(fn, { timeoutMs = 60000, everyMs = 500 } = {}) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } await sleep(everyMs); }
  return null;
}
