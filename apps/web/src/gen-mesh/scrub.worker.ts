/// <reference lib="webworker" />
// Phone arrival (lane L3): desert scrub off the main thread. A Mars arrival spent ~0.45 s of a 4x-throttled main thread on
// scrubPoints (playa veins, clumps, the random stream, spacing) while the terrain and GLBs were waiting for it.
// Messages:
//   {id, kind: 'points', area, params, seed, cells, C, selfId} -> {id, pts: Float64Array [x, z, k, s, yaw, tone]*} — the
//     whole scatter with the viewer's own blocked-ground test (block-test.ts), when no water can reach the area;
//   {id, area, params, seed} -> {id, v: {key, marks}} — only the noise verdicts (the viewer replays them).
import { scrubPoints, scrubVerdicts } from '../../../../packages/generators/src/desert.ts';
import { blockTest, type BlockCells } from './block-test.ts';

type Msg = { id: number; kind?: 'points'; area: [number, number][]; params: Record<string, never>; seed: number; cells?: BlockCells; C?: number; selfId?: string };
self.onmessage = (ev: MessageEvent<Msg>) => {
  const { id, kind, area, params, seed } = ev.data;
  const post = (m: unknown, t: Transferable[] = []) => (self as unknown as Worker).postMessage(m, t);
  try {
    if (kind === 'points') {
      const pts = scrubPoints(area, params, seed, blockTest(ev.data.cells!, ev.data.C!, ev.data.selfId!));
      const out = new Float64Array(pts.length * 6);
      pts.forEach((p, i) => { out.set([p.x, p.z, p.k, p.s, p.yaw, p.tone], i * 6); });
      post({ id, pts: out }, [out.buffer]);
      return;
    }
    const v = scrubVerdicts(area, params, seed);
    post({ id, v }, v.marks.map((a) => a.buffer));
  } catch {
    post({ id, v: null, pts: null });
  }
};
