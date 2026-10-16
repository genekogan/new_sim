/// <reference lib="webworker" />
// WorldMeshLod's simplifier, off the main thread (release 3.1 speed): a phone used to stall 100–400 ms per big mesh
// while meshoptimizer simplified it, about 5 s of jank in the first seconds after arrival on Mars.
// Messages: {id, input, ratios, maxError} -> {id, levels} (index buffers transferred) or {id, error}; {id:0} -> ready.
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';
import { simplifyLevels, type LodInput, type Simplifier } from './mesh-lod-core.ts';

const ready = MeshoptSimplifier.ready.then(() => MeshoptSimplifier.supported);
self.onmessage = async (ev: MessageEvent<{ id: number; input?: LodInput; ratios?: number[]; maxError?: number }>) => {
  const { id, input, ratios, maxError } = ev.data;
  try {
    const ok = await ready;
    if (!id) { (self as unknown as Worker).postMessage({ id: 0, ready: ok }); return; }
    if (!ok || !input || !ratios) throw new Error('simplifier unavailable');
    const levels = simplifyLevels(MeshoptSimplifier as unknown as Simplifier, input, ratios, maxError ?? Number.MAX_VALUE);
    (self as unknown as Worker).postMessage({ id, levels }, levels.map((l) => l.index.buffer));
  } catch (e) { (self as unknown as Worker).postMessage({ id, error: String((e as Error)?.message ?? e) }); }
};
