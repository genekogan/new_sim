// Phone arrival (lane L3): the playa terrain's mottling in a worker (terrain-color.worker.ts) for a world's first terrain
// build; the sector shows its unmottled colours until the worker answers (behind the arrival card on a phone). No Worker
// (tests), a failed worker or `?terrainWorker=0`: mottled in place, as before. Same floats either way.
import { mottleColors } from './playa-mottle.ts';

let w: Worker | null | undefined;
const waits = new Map<number, (out: Float32Array | null) => void>();
let next = 0;
function worker(): Worker | null {
  if (w !== undefined) return w;
  try {
    const off = typeof location !== 'undefined' && new URLSearchParams(location.search).get('terrainWorker') === '0';
    w = off || typeof Worker === 'undefined' ? null : new Worker(new URL('./terrain-color.worker.ts', import.meta.url), { type: 'module' });
  } catch { w = null; }
  if (w) {
    w.onmessage = (ev: MessageEvent<{ id: number; out: Float32Array | null }>) => { const f = waits.get(ev.data.id); waits.delete(ev.data.id); f?.(ev.data.out); };
    w.onerror = () => { for (const f of waits.values()) f(null); waits.clear(); w?.terminate(); w = null; };
  }
  return w;
}
/** Mottle `idx` of a sector's colours: `apply(colours)` gets the finished array (now, or when the worker answers). */
export function mottleSector(rgb: Float64Array, xz: Float64Array, idx: Uint32Array, colours: Float32Array, apply: (out: Float32Array) => void) {
  const now = () => { mottleColors(rgb, xz, colours, idx); apply(colours); };
  const ww = worker(); if (!ww) { now(); return; }
  const id = ++next, copy = colours.slice();
  waits.set(id, (out) => { if (out) apply(out); else now(); });
  try { ww.postMessage({ id, rgb, xz, idx, base: copy }, [rgb.buffer, xz.buffer, idx.buffer, copy.buffer]); } catch { waits.delete(id); now(); }
}
