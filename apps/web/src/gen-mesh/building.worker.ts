/// <reference lib="webworker" />
// Lane W1: a building's geometry (building.mesh.ts buildingBuffers) off the main thread during a world's first build.
// Messages: {id, job} -> {id, out} (out's float arrays transferred), out null when it failed (the page builds it itself).
import { buildingBuffers, type BuildingJob } from './building.mesh.ts';

self.onmessage = (ev: MessageEvent<{ id: number; job: BuildingJob }>) => {
  const { id, job } = ev.data;
  try {
    const out = buildingBuffers(job);
    (self as unknown as Worker).postMessage({ id, out }, out.raw.flatMap((r) => [r.p.buffer, r.n.buffer, r.c.buffer]));
  } catch {
    (self as unknown as Worker).postMessage({ id, out: null });
  }
};
