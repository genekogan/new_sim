/// <reference lib="webworker" />
// Phone arrival (lane L3): the playa terrain's mottling off the main thread (~0.3 s of a 4x-throttled Mars arrival).
// Messages: {id, rgb, xz, idx, n} -> {id, out} (out transferred): out = the sector's float colours with idx mottled.
import { mottleColors } from './playa-mottle.ts';

self.onmessage = (ev: MessageEvent<{ id: number; rgb: Float64Array; xz: Float64Array; idx: Uint32Array; base: Float32Array }>) => {
  const { id, rgb, xz, idx, base } = ev.data;
  try {
    mottleColors(rgb, xz, base, idx);
    (self as unknown as Worker).postMessage({ id, out: base }, [base.buffer]);
  } catch {
    (self as unknown as Worker).postMessage({ id, out: null });
  }
};
