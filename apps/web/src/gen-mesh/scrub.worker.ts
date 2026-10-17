/// <reference lib="webworker" />
// Phone arrival (lane L3): desert-scrub noise verdicts off the main thread. A Mars arrival spent ~0.45 s of a 4x-throttled
// main thread on scrubPoints' playa veins and clumps while the terrain and GLBs were waiting for it.
// Messages: {id, area, params, seed} -> {id, v: {key, marks}} (marks transferred) or {id, v: null}.
import { scrubVerdicts } from '../../../../packages/generators/src/desert.ts';

self.onmessage = (ev: MessageEvent<{ id: number; area: [number, number][]; params: Record<string, never>; seed: number }>) => {
  const { id, area, params, seed } = ev.data;
  try {
    const v = scrubVerdicts(area, params, seed);
    (self as unknown as Worker).postMessage({ id, v }, v.marks.map((a) => a.buffer));
  } catch {
    (self as unknown as Worker).postMessage({ id, v: null });
  }
};
