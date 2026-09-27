// End-of-tick invariants (spec §31). They never correct anything — they
// record violations so rehearsal reports and tests can fail loudly.
import type { Diagnostic } from '../actions/types.ts';
import { clearanceAt } from '../spatial/grid.ts';
import type { Spatial } from '../spatial/service.ts';
import type { Invariant, Runtime } from './runtime.ts';
import { HUMAN_RADIUS } from '../world/catalog.ts';

const TOL = 0.03;

export const humanStaticClearance: Invariant = (rt: Runtime) => {
  const sp = rt.services.spatial as Spatial;
  sp.sync(rt.world);
  const out: Diagnostic[] = [];
  for (const e of Object.values(rt.world.entities)) {
    if (e.kind !== 'human' || !e.human || e.human.activity.startsWith('climb')) continue;
    const g = sp.level(e.human.level);
    if (!g) continue;
    const c = clearanceAt(g, [e.pose.p[0], e.pose.p[2]]);
    if (c < HUMAN_RADIUS - TOL)
      out.push({
        code: 'collision.human-static',
        message: `${e.id} body overlaps static geometry (clearance ${c.toFixed(2)} m < ${HUMAN_RADIUS} m)`,
        subjects: [e.id],
        at: e.pose.p,
      });
  }
  return out;
};

export const humanHumanSeparation: Invariant = (rt: Runtime) => {
  const hs = Object.values(rt.world.entities).filter((e) => e.kind === 'human' && e.human);
  const out: Diagnostic[] = [];
  for (let i = 0; i < hs.length; i++)
    for (let j = i + 1; j < hs.length; j++) {
      const a = hs[i], b = hs[j];
      if (a.human!.level !== b.human!.level) continue;
      if (Math.abs(a.pose.p[1] - b.pose.p[1]) > 1.0) continue;
      const d = Math.hypot(a.pose.p[0] - b.pose.p[0], a.pose.p[2] - b.pose.p[2]);
      if (d < 2 * HUMAN_RADIUS - 0.08)
        out.push({ code: 'collision.human-human', message: `${a.id} and ${b.id} overlap (${d.toFixed(2)} m apart)`, subjects: [a.id, b.id], at: a.pose.p });
    }
  return out;
};

export const noUnsupported: Invariant = (rt: Runtime) =>
  Object.values(rt.world.entities)
    .filter((e) => e.kind === 'component' && e.support?.kind === 'none')
    .map((e) => ({ code: 'support.unsupported', message: `${e.id} (${e.def}) has no support`, subjects: [e.id], at: e.pose.p }));

export const DEFAULT_INVARIANTS = [humanStaticClearance, humanHumanSeparation, noUnsupported];
